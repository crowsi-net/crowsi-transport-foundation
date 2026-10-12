import assert from 'node:assert/strict'
import { createProviderHttpTransport } from '@crowsi/provider-http-transport'
import { createLocalProviderControl } from '@crowsi/provider-http-transport/local-control'
const token = 'synthetic-credential-not-a-real-account'
let state = { label: 'before' }, echo = false, credentialCalls = 0
const operations = [
  { id: 'read', effect: 'read', requiredPermissions: [], build: () => ({ method: 'GET', url: 'https://synthetic.test/state' }) },
  { id: 'write', effect: 'write', requiredPermissions: ['state.write'], build: input => ({ method: 'PATCH', url: 'https://synthetic.test/state', body: JSON.stringify(input) }) },
]
const control = createLocalProviderControl({
  account: { provider: 'fixture', account: 'synthetic', subject: 'owner' }, operations,
  allowedOrigins: ['https://synthetic.test'], credentials: { acquire: async () => { credentialCalls++; return token } },
  fetchImplementation: async (url, init) => {
    assert.equal(String(url), 'https://synthetic.test/state')
    assert.equal(init.headers.Authorization, `Bearer ${token}`)
    if (echo) return new Response(`{"nested":{"\\u0073ynthetic-credential-not-a-real-account":"safe"}}`)
    if (init.method === 'PATCH') state = JSON.parse(init.body)
    return Response.json(state)
  },
})
async function execute(id, input) {
  const plan = control.prepare(id, input), grant = control.approve(plan, Date.now() + 10000)
  return { receipt: await control.execute(grant.id, plan), grant, plan }
}
const write = await execute('write', { label: 'after' })
assert.deepEqual((await execute('read', {})).receipt.data, { label: 'after' })
const calls = credentialCalls
await assert.rejects(control.execute(write.grant.id, write.plan), /grant\/unknown/)
assert.equal(credentialCalls, calls, 'replay must not reacquire credentials')
echo = true
await assert.rejects(execute('read', {}), error => error.message === 'provider/response/credential-rejected' && !String(error).includes(token))
const transport = createProviderHttpTransport({ allowedOrigins: ['https://synthetic.test'], fetchImplementation: async () => Response.json({ ok: true }) })
assert.equal((await transport.request({ url: 'https://synthetic.test/state' })).status, 200)

console.log(JSON.stringify({ provider: 'synthetic', readBack: state, replayRejected: true, credentialEchoRejected: true }))
