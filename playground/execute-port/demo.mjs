import assert from 'node:assert/strict'
import { createLocalProviderControl } from '@crowsi/provider-http-transport/local-control'
import { createExecutePort } from '@crowsi/provider-http-transport/execute-port'
let state = { label: 'before' }, calls = 0
const control = createLocalProviderControl({
  account: { provider: 'fixture', account: 'synthetic', subject: 'owner' },
  credentials: { acquire: async () => 'synthetic-never-real-credential' },
  allowedOrigins: ['https://fixture.example.test'],
  operations: [
    { id: 'resource.write', effect: 'write', requiredPermissions: ['fixture.write'],
      build: () => ({ url: 'https://fixture.example.test/resource', method: 'PATCH', body: '{"label":"after"}' }) },
    { id: 'resource.read', effect: 'read', requiredPermissions: ['fixture.read'],
      build: () => ({ url: 'https://fixture.example.test/resource', method: 'GET' }) },
  ],
  fetchImplementation: async (_url, init) => {
    calls++
    if (init.method === 'PATCH') state = JSON.parse(init.body)
    return new Response(JSON.stringify(state))
  },
})
const owner = createExecutePort(control)
// A native isolated worker receives only this function and a serialized request.
const execute = owner.handle
for (const operation of ['resource.write', 'resource.read']) {
  const plan = control.prepare(operation, {})
  const permit = control.approve(plan, Date.now() + 10000)
  const request = owner.register(plan, permit)
  await assert.rejects(execute({ ...request, operation: 'approve' }), /rejected/)
  assert.equal((await execute(JSON.parse(JSON.stringify(request)))).data.label, 'after')
  await assert.rejects(execute(request), /rejected/)
}
assert.equal(calls, 2)
console.log('Execute-only public archive: write/read-back, approval rejection and replay rejection passed')
