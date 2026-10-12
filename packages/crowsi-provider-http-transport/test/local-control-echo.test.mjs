import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalProviderControl } from '../dist/local-control.mjs'
const token = 'synthetic-bearer-not-a-real-account'
const escaped = `\\u${token.charCodeAt(0).toString(16).padStart(4, '0')}${token.slice(1)}`
function fixture(body) {
  const control = createLocalProviderControl({
    account: { provider: 'synthetic', subject: 'owner', account: 'test' },
    operations: [
      {
        id: 'read',
        effect: 'read',
        requiredPermissions: [],
        build: () => ({ method: 'GET', url: 'https://synthetic.test/resource' }),
      },
    ],
    allowedOrigins: ['https://synthetic.test'],
    credentials: { acquire: async () => token },
    fetchImplementation: async () => new Response(body, { status: 200 }),
  })
  const plan = control.prepare('read', {})
  const grant = control.approve(plan, Date.now() + 30000)
  return () => control.execute(grant.id, plan)
}
for (const [name, body] of [
  ['literal nested value', JSON.stringify({ nested: { value: token } })],
  ['partially escaped nested value', `{"nested":{"value":"${escaped}"}}`],
  ['partially escaped array value', `{"items":["${escaped}"]}`],
  ['partially escaped object key', `{"${escaped}":"safe"}`],
]) {
  test(`rejects ${name} without a credential-bearing error`, async () => {
    await assert.rejects(fixture(body)(), (error) => {
      assert.equal(error.message, 'provider/response/credential-rejected')
      assert.ok(!String(error).includes(token))
      return true
    })
  })
}
test('preserves normal JSON and legitimate Unicode values', async () => {
  const data = { nested: ['正常値', '☃'], count: 3, empty: null }
  const receipt = await fixture(JSON.stringify(data))()
  assert.deepEqual(receipt.data, data)
  assert.ok(!JSON.stringify(receipt).includes(token))
})
