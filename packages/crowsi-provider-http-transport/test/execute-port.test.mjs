import assert from 'node:assert/strict'
import test from 'node:test'
import { createExecutePort } from '../dist/execute-port.mjs'
import { createLocalProviderControl } from '../dist/local-control.mjs'
function fixture() {
  let calls = 0
  const control = createLocalProviderControl({
    account: { provider: 'fixture', account: 'fixture-account', subject: 'fixture-owner' },
    credentials: { acquire: async () => 'synthetic-never-real-bearer' },
    operations: [
      {
        id: 'resource.write',
        effect: 'write',
        requiredPermissions: ['resource.write'],
        build: () => ({ method: 'PATCH', url: 'https://api.example.test/resource', body: '{}' }),
      },
    ],
    allowedOrigins: ['https://api.example.test'],
    clock: () => 1000,
    fetchImplementation: async () => {
      calls++
      return new Response(null, { status: 204 })
    },
  })
  const port = createExecutePort(control, () => 1000)
  const plan = control.prepare('resource.write', {}),
    permit = control.approve(plan, 2000)
  return { control, port, plan, permit, request: port.register(plan, permit), calls: () => calls }
}
test('a generated caller can execute only an owner-registered exact request once', async () => {
  const f = fixture()
  const receipt = await f.port.handle(f.request)
  assert.equal(receipt.status, 204)
  assert.equal(receipt.operation, 'resource.write')
  await assert.rejects(f.port.handle(f.request), /execute-port\/rejected/)
  assert.equal(f.calls(), 1)
})
test('worker requests cannot approve, acquire credentials or substitute plan/account fields', async () => {
  const f = fixture()
  for (const input of [
    null,
    [],
    { operation: 'approve' },
    { ...f.request, account: 'other' },
    { ...f.request, requestDigest: '0'.repeat(64) },
    { ...f.request, credential: 'fixture' },
  ]) {
    await assert.rejects(f.port.handle(input), /execute-port\/rejected/)
  }
  assert.equal(f.calls(), 0)
  assert.equal((await f.port.handle(f.request)).status, 204)
})
test('owner revocation prevents effects through the exposed execute port', async () => {
  const f = fixture()
  f.port.revoke(f.request.grantId)
  await assert.rejects(f.port.handle(f.request), /execute-port\/rejected/)
  assert.equal(f.calls(), 0)
})
test('registration snapshots the caller plan and rejects mismatched permit binding', async () => {
  const f = fixture()
  assert.throws(() => f.port.register(f.plan, { ...f.permit, digest: '0'.repeat(64) }), /registration/)
  assert.throws(() => f.port.register(f.plan, f.permit), /registration/)
})
