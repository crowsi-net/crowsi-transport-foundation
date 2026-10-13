import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { createServer } from 'node:net'
import { createLocalProviderControl } from '@crowsi/provider-http-transport/local-control'
import { createExecutePort } from '@crowsi/provider-http-transport/execute-port'
const helper = process.env.CROWSI_WORKLOAD_HELPER
assert.ok(helper && isAbsolute(helper), 'An independently built Crowsi workload helper is required')
const stage = mkdtempSync(join(tmpdir(), 'crowsi-native-worker-')), privateRoot = mkdtempSync(join(tmpdir(), 'crowsi-native-owner-'))
chmodSync(stage, 0o700); chmodSync(privateRoot, 0o700)
writeFileSync(join(privateRoot, 'secret'), 'synthetic-private-owner-secret')
const server = createServer(socket => socket.destroy())
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let state = { label: 'before' }, calls = 0
const control = createLocalProviderControl({
  account: { provider: 'fixture', account: 'synthetic', subject: 'owner' },
  credentials: { acquire: async () => 'synthetic-never-real-bearer' },
  allowedOrigins: ['https://fixture.example.test'],
  operations: [
    { id: 'resource.write', effect: 'write', requiredPermissions: ['fixture.write'],
      build: () => ({ url: 'https://fixture.example.test/resource', method: 'PATCH', body: '{"label":"after"}' }) },
    { id: 'resource.read', effect: 'read', requiredPermissions: ['fixture.read'],
      build: () => ({ url: 'https://fixture.example.test/resource', method: 'GET' }) },
  ],
  fetchImplementation: async (_url, init) => {
    calls++; if (init.method === 'PATCH') state = JSON.parse(init.body)
    return new Response(JSON.stringify(state))
  },
})
const owner = createExecutePort(control)
try {
  writeFileSync(join(stage, 'worker.mjs'), `
import { existsSync } from 'node:fs'; import { createConnection } from 'node:net';
let text=''; for await(const chunk of process.stdin){text+=chunk;if(text.length>4096)throw Error('input budget')}
const input=JSON.parse(text);
const reached=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:input.port});
 socket.setTimeout(500);socket.on('connect',()=>{socket.destroy();resolve(true)});
 socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false)})});
console.log(JSON.stringify({type:'probe',privateVisible:existsSync(input.privatePath),ambientSecret:process.env.FAKE_OWNER_SECRET??null,hostNetwork:reached}));
console.log(JSON.stringify({...input.execute,operation:'approve'}));
console.log(JSON.stringify(input.execute));
`)
  for (const operation of ['resource.write', 'resource.read']) {
    const plan = control.prepare(operation, {}), permit = control.approve(plan, Date.now() + 20000)
    const request = owner.register(plan, permit)
    const stdout = execFileSync(helper, [realpathSync(process.execPath), realpathSync(stage)], {
      input: JSON.stringify({ execute: request, privatePath: join(privateRoot, 'secret'), port: server.address().port }),
      env: { ...process.env, FAKE_OWNER_SECRET: 'synthetic-ambient-secret' }, encoding: 'utf8', maxBuffer: 4096, timeout: 15000,
    })
    const [probe, attack, execute] = stdout.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(probe.privateVisible, false); assert.equal(probe.ambientSecret, null); assert.equal(probe.hostNetwork, false)
    const before = calls
    await assert.rejects(owner.handle(attack), /rejected/)
    assert.equal(calls, before)
    assert.equal((await owner.handle(execute)).data.label, 'after')
    await assert.rejects(owner.handle(execute), /rejected/)
  }
  assert.equal(calls, 2)
  console.log('Native worker/owner integration: hidden host data, blocked direct network, write/read-back and approval/replay rejection passed')
} finally {
  await new Promise(resolve => server.close(resolve)); rmSync(stage, { recursive: true, force: true }); rmSync(privateRoot, { recursive: true, force: true })
}
