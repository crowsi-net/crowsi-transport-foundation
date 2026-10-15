import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseNotice, verifyPublication, boundedRead } from './reconcile_stage.mts';
const notice = { repository: 'fixture/owner', name: '@fixture/tool', version: '1.2.3',
  source: 'a'.repeat(40), sha256: createHash('sha256').update('reviewed archive').digest('hex'),
  stageId: '11111111-2222-3333-4444-555555555555', ciUrl: 'https://github.com/fixture/owner/actions/runs/123' };
const issue = () => ({ title: `[npm stage] Review ${notice.stageId}`, state: 'open',
  user: { login: 'github-actions[bot]' }, body: `<!-- npm-stage:${notice.stageId} -->\n- Package: \u0060${notice.name}@${notice.version}\u0060\n- Stage ID: \u0060${notice.stageId}\u0060\n- Archive SHA256: \u0060${notice.sha256}\u0060\n- Source: \u0060${notice.source}\u0060\n- Source/build CI: [run](${notice.ciUrl})\n` });
function fixture() {
  const archive = Buffer.from('reviewed archive');
  const sha512 = createHash('sha512').update(archive).digest();
  const statement = { _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
    subject: [{ name: 'pkg:npm/%40fixture/tool@1.2.3', digest: { sha512: sha512.toString('hex') } }],
    predicate: { buildDefinition: { buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
      externalParameters: { workflow: { repository: 'https://github.com/fixture/owner', path: '.github/workflows/publish-npm.yml', ref: 'refs/tags/npm/fixture--tool/v1.2.3' } },
      internalParameters: { github: { event_name: 'push' } },
      resolvedDependencies: [{ uri: 'git+https://github.com/fixture/owner@refs/tags/npm/fixture--tool/v1.2.3', digest: { gitCommit: notice.source } }] },
      runDetails: { metadata: { invocationId: `${notice.ciUrl}/attempts/1` } } } };
  const metadata = { name: notice.name, version: notice.version, dist: {
    tarball: 'https://registry.npmjs.org/@fixture/tool/-/tool-1.2.3.tgz', integrity: `sha512-${sha512.toString('base64')}`,
    attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/%40fixture%2ftool@1.2.3' } } };
  const requested: string[] = [];
  const read = async (url: string) => {
    requested.push(url);
    if (url.endsWith('/1.2.3')) return Buffer.from(JSON.stringify(metadata));
    if (url.endsWith('.tgz')) return archive;
    return Buffer.from(JSON.stringify({ attestations: [{ predicateType: statement.predicateType,
      bundle: { dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } }] }));
  };
  return { statement, metadata, read, requested };
}
test('one owner bot notice binds the stage, package, source and source CI', () => {
  assert.deepEqual(parseNotice(issue(), notice.repository, [notice.name]), notice);
});
test('human issues, other packages, duplicate fields, misleading stages and cross-owner runs are retained', () => {
  for (const change of [
    { user: { login: 'someone' } }, { state: 'closed' }, { pull_request: {} },
    { body: issue().body + `- Source: \u0060${notice.source}\u0060\n` },
    { body: issue().body.replace('actions/runs/123', 'actions/runs/123/other') },
    { body: issue().body.replace('fixture/owner/actions', 'other/owner/actions') },
    { body: issue().body + `<!-- npm-stage:${notice.stageId} -->` },
  ]) assert.throws(() => parseNotice({ ...issue(), ...change }, notice.repository, [notice.name]));
  assert.throws(() => parseNotice(issue(), notice.repository, ['other']));
});
test('public bytes and exact signed workflow identity are verified before acceptance', async () => {
  const f = fixture(); let called = 0;
  await verifyPublication(notice, f.read, async (_bundle, identity) => {
    called++; assert.equal(identity, 'https://github.com/fixture/owner/.github/workflows/publish-npm.yml@refs/tags/npm/fixture--tool/v1.2.3');
  });
  assert.equal(called, 1); assert.equal(f.requested.length, 3);
});
test('a cryptographic verification failure cannot become public success', async () => {
  const f = fixture();
  await assert.rejects(verifyPublication(notice, f.read, async () => { throw Error('signature rejected'); }), /signature rejected/);
});
test('changed archive bytes, unavailable versions and attestation absence are not accepted', async () => {
  await assert.rejects(verifyPublication({ ...notice, sha256: '0'.repeat(64) }, fixture().read, async () => {}));
  await assert.rejects(verifyPublication(notice, async () => { throw Error('404'); }, async () => {}));
  const f = fixture();
  await assert.rejects(verifyPublication(notice, async (url) => url.includes('/attestations/') ? Buffer.from('{"attestations":[]}') : f.read(url), async () => {}));
});
test('foreign tarball and attestation origins are rejected without fetching those URLs', async () => {
  for (const kind of ['archive', 'attestation']) {
    const f = fixture();
    if (kind === 'archive') f.metadata.dist.tarball = 'https://untrusted.invalid/archive.tgz';
    else f.metadata.dist.attestations.url = 'https://untrusted.invalid/attestation';
    await assert.rejects(verifyPublication(notice, f.read, async () => {}));
    assert.ok(f.requested.every(url => url.startsWith('https://registry.npmjs.org/')));
  }
});
test('forged provenance source, workflow, event, subject and run bindings are rejected', async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.statement.subject[0].digest.sha512 = '0'.repeat(128); },
    (f: ReturnType<typeof fixture>) => { f.statement.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/other/owner'; },
    (f: ReturnType<typeof fixture>) => { f.statement.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/untrusted.yml'; },
    (f: ReturnType<typeof fixture>) => { f.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.statement.predicate.buildDefinition.internalParameters.github.event_name = 'pull_request_target'; },
    (f: ReturnType<typeof fixture>) => { f.statement.predicate.runDetails.metadata.invocationId = 'https://github.com/other/owner/actions/runs/123/attempts/1'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); let verified = false;
    await assert.rejects(verifyPublication(notice, f.read, async () => { verified = true; }));
    assert.equal(verified, false);
  }
});
test('fetch refuses redirects and excessive response bodies with an overall deadline', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.redirect, 'error'); assert.ok(options?.signal);
      return new Response('too large', { headers: { 'content-length': '1000' } });
    };
    await assert.rejects(boundedRead('https://registry.npmjs.org/fixture', 4), /byte budget/);
    globalThis.fetch = async () => new Response('too large');
    await assert.rejects(boundedRead('https://registry.npmjs.org/fixture', 4), /byte budget/);
  } finally { globalThis.fetch = original; }
});
