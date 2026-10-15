/** Close only this owner's bot notice after verifying immutable public bytes and CI provenance. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type ObjectValue = Record<string, unknown>;
export interface Notice {
  repository: string; source: string; name: string; version: string;
  sha256: string; stageId: string; ciUrl: string;
}
type Reader = (url: string, budget: number) => Promise<Buffer>;
type Verifier = (bundle: unknown, identity: string) => Promise<void>;
const registry = 'https://registry.npmjs.org';
const issuer = 'https://token.actions.githubusercontent.com';
const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected an object');
  return value as ObjectValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error('Expected an array');
  return value;
}
function requireMatch(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw Error('Invalid public binding');
  return value;
}
export function parseNotice(issue: unknown, repository: string, names: string[]): Notice {
  const row = object(issue);
  if (object(row.user).login !== 'github-actions[bot]' || row.pull_request || row.state !== 'open') {
    throw Error('Only an open Actions bot issue is eligible');
  }
  const title = requireMatch(row.title, new RegExp(`^\\[npm stage\\] Review (${uuid})$`));
  const stageId = title.slice('[npm stage] Review '.length);
  const body = requireMatch(row.body, /^[\s\S]{1,16384}$/);
  if ((body.match(/<!-- npm-stage:/g) ?? []).length !== 1 || !body.includes(`<!-- npm-stage:${stageId} -->`)) {
    throw Error('Exactly one matching stage marker is required');
  }
  const field = (label: string, pattern: string): string => {
    const matches = [...body.matchAll(new RegExp(`^- ${label}: \u0060(${pattern})\u0060$`, 'gm'))];
    if (matches.length !== 1) throw Error('Missing or ambiguous notification field');
    return matches[0][1];
  };
  const pack = field('Package', '(?:@[a-z0-9_.-]+/)?[a-z0-9_.-]+@[0-9][A-Za-z0-9.+-]*');
  const at = pack.lastIndexOf('@');
  const name = pack.slice(0, at);
  const version = requireMatch(pack.slice(at + 1), /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?$/);
  if (!names.includes(name)) throw Error('Package is outside this owner contract');
  const run = [...body.matchAll(/^- Source\/build CI: \[run\]\((https:\/\/github\.com\/[^\s)]+)\)$/gm)];
  if (run.length !== 1 || !run[0][1].startsWith(`https://github.com/${repository}/actions/runs/`) ||
      !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[1-9][0-9]*$/.test(run[0][1])) {
    throw Error('The source run must belong to this owner');
  }
  if (field('Stage ID', uuid) !== stageId) throw Error('Stage identity differs');
  return { repository, name, version, stageId, ciUrl: run[0][1],
    source: field('Source', '[a-f0-9]{40}'), sha256: field('Archive SHA256', '[a-f0-9]{64}') };
}

export async function boundedRead(url: string, budget: number, headers: Record<string, string> = {}): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers });
  if (!response.ok || !response.body) throw Error(`Public evidence unavailable (HTTP ${response.status})`);
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > budget)) {
    await response.body.cancel(); throw Error('Evidence exceeds byte budget');
  }
  const parts: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > budget) throw Error('Evidence exceeds byte budget');
      parts.push(part.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}

export async function verifyPublication(notice: Notice, read: Reader, verify: Verifier): Promise<void> {
  const encoded = encodeURIComponent(notice.name);
  const metadata = object(JSON.parse((await read(`${registry}/${encoded}/${notice.version}`, 2 * 1024 ** 2)).toString()));
  if (metadata.name !== notice.name || metadata.version !== notice.version || metadata.deprecated) {
    throw Error('Public version identity differs');
  }
  const dist = object(metadata.dist);
  const base = notice.name.split('/').at(-1);
  const archiveUrl = `${registry}/${notice.name}/-/${base}-${notice.version}.tgz`;
  if (dist.tarball !== archiveUrl) throw Error('Only the exact official tarball URL is allowed');
  const archive = await read(archiveUrl, 32 * 1024 ** 2);
  const sha512 = createHash('sha512').update(archive).digest();
  if (createHash('sha256').update(archive).digest('hex') !== notice.sha256 ||
      dist.integrity !== `sha512-${sha512.toString('base64')}`) throw Error('Published bytes differ from stage notice');
  const attestationUrl = `${registry}/-/npm/v1/attestations/${encoded}@${notice.version}`;
  // Registry normalization may use lowercase percent escapes for the scoped slash.
  const advertised = new URL(requireMatch(object(dist.attestations).url, /^https:\/\/registry\.npmjs\.org\//));
  if (advertised.origin !== registry || advertised.search || advertised.hash ||
      decodeURIComponent(advertised.pathname) !== decodeURIComponent(new URL(attestationUrl).pathname)) {
    throw Error('Attestation endpoint differs from the exact package');
  }
  const attestations = object(JSON.parse((await read(attestationUrl, 4 * 1024 ** 2)).toString()));
  const entries = array(attestations.attestations).map(object).filter(a => a.predicateType === 'https://slsa.dev/provenance/v1');
  if (entries.length !== 1) throw Error('Exactly one CI provenance statement is required');
  const bundle = object(entries[0].bundle);
  const envelope = object(bundle.dsseEnvelope);
  if (envelope.payloadType !== 'application/vnd.in-toto+json') throw Error('Unknown attestation payload type');
  const payload = requireMatch(envelope.payload, /^[A-Za-z0-9+/]+={0,2}$/);
  const statement = object(JSON.parse(Buffer.from(payload, 'base64').toString()));
  const subjects = array(statement.subject).map(object);
  const subjectName = `pkg:npm/${notice.name.replace('@', '%40')}@${notice.version}`;
  if (statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== entries[0].predicateType ||
      subjects.length !== 1 || subjects[0].name !== subjectName || object(subjects[0].digest).sha512 !== sha512.toString('hex')) {
    throw Error('Provenance subject does not bind the exact package bytes');
  }
  const predicate = object(statement.predicate);
  const definition = object(predicate.buildDefinition);
  const workflow = object(object(definition.externalParameters).workflow);
  const tag = `npm/${notice.name.replace(/^@/, '').replace('/', '--')}/v${notice.version}`;
  if (definition.buildType !== 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1' ||
      workflow.repository !== `https://github.com/${notice.repository}` || workflow.path !== '.github/workflows/publish-npm.yml' ||
      ![`refs/tags/${tag}`, `refs/tags/v${notice.version}`].includes(String(workflow.ref))) {
    throw Error('Provenance workflow differs from the owner release workflow');
  }
  const deps = array(definition.resolvedDependencies).map(object);
  if (deps.length !== 1 || deps[0].uri !== `git+https://github.com/${notice.repository}@${workflow.ref}` ||
      object(deps[0].digest).gitCommit !== notice.source) throw Error('Provenance source commit differs');
  const invocation = String(object(object(predicate.runDetails).metadata).invocationId);
  if (!invocation.startsWith(`${notice.ciUrl}/attempts/`) || !/\/attempts\/[1-9][0-9]*$/.test(invocation)) {
    throw Error('Provenance source run differs');
  }
  const event = object(object(definition.internalParameters).github).event_name;
  if (!['push', 'workflow_dispatch'].includes(String(event))) throw Error('Untrusted publication event');
  // Fulcio identity, signature, Rekor inclusion and trusted roots are checked by npm's pinned Sigstore dependency.
  await verify(bundle, `https://github.com/${notice.repository}/.github/workflows/publish-npm.yml@${workflow.ref}`);
}

export async function sigstoreVerifier(): Promise<Verifier> {
  const root = execFileSync('npm', ['root', '--global'], { encoding: 'utf8', timeout: 30000 }).trim();
  const require = createRequire(join(root, 'npm/package.json'));
  const npm = require('./package.json') as { version: string };
  if (npm.version !== '12.2.0') throw Error('Install the reviewed npm@12.2.0 verifier toolchain');
  const sigstore = require('sigstore') as { verify: (bundle: unknown, options: ObjectValue) => Promise<void> };
  return async (bundle, identity) => {
    await sigstore.verify(bundle, { certificateIdentityURI: identity, certificateIssuer: issuer,
      timeout: 15000, retry: 0, tlogThreshold: 1, ctLogThreshold: 1,
      tufCachePath: join(process.env.RUNNER_TEMP ?? '/tmp', 'npm-stage-sigstore-cache') });
  };
}

async function main(): Promise<void> {
  const repository = requireMatch(process.env.GITHUB_REPOSITORY, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const contract = object(JSON.parse(readFileSync('.github/registry-release.json', 'utf8')));
  if (contract.repository !== repository) throw Error('Owner contract differs');
  const names = array(contract.packages).map(object).filter(p => p.ecosystem === 'npm').map(p => String(p.name));
  const token = process.env.GH_TOKEN;
  if (!token) throw Error('Repository-scoped issue token required');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async (path: string) => JSON.parse((await boundedRead(`https://api.github.com/repos/${repository}/${path}`, 4 * 1024 ** 2, headers)).toString());
  const metadata = object(await api(''));
  if (metadata.full_name !== repository || metadata.private !== false || metadata.archived) throw Error('Active public owner required');
  const verify = await sigstoreVerifier();
  const result = { checked: 0, closed: 0, retained: 0, partial: false, observeOnly: process.argv.includes('--observe-only') };
  for (let page = 1; page <= 5; page++) {
    const issues = array(await api(`issues?state=open&per_page=100&page=${page}`));
    for (const raw of issues) {
      const row = object(raw);
      if (typeof row.title !== 'string' || !new RegExp(`^\\[npm stage\\] Review ${uuid}$`).test(row.title)) continue;
      if (result.checked >= 20) { result.partial = true; break; }
      result.checked++;
      try {
        const notice = parseNotice(row, repository, names);
        const run = object(await api(`actions/runs/${notice.ciUrl.split('/').at(-1)}`));
        if (run.path !== '.github/workflows/publish-npm.yml' || run.head_sha !== notice.source ||
            run.status !== 'completed' || run.conclusion !== 'success' ||
            !['push', 'workflow_dispatch'].includes(String(run.event))) throw Error('Source release run is not accepted');
        await verifyPublication(notice, boundedRead, verify);
        const fresh = object(await api(`issues/${row.number}`));
        parseNotice(fresh, repository, names);
        if (fresh.body !== row.body || fresh.title !== row.title) throw Error('Issue changed during verification');
        if (!result.observeOnly) {
          const response = await fetch(`https://api.github.com/repos/${repository}/issues/${row.number}`, {
            method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(20000), headers,
            body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
          if (!response.ok) throw Error('Issue close was not confirmed');
          if (object(await api(`issues/${row.number}`)).state !== 'closed') throw Error('Issue close read-back failed');
          result.closed++;
        }
      } catch { result.retained++; } // Unknown, missing, changed or unverified evidence never closes a notice.
    }
    if (result.partial || issues.length < 100) break;
    if (page === 5) result.partial = true;
  }
  const summary = JSON.stringify(result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## npm publication notice reconciliation\n\n\u0060${summary}\u0060\n\nOnly exact public bytes and cryptographically verified owner CI provenance permit closure. Retained entries require later verification; no npm approval or publication occurs.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Publication notice reconciliation stopped; no unverified issue is accepted.'); process.exitCode = 1; });
}
