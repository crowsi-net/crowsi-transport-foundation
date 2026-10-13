import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalProviderControl } from '../dist/local-control.mjs'
const account = { provider: 'test', account: 'account-a', subject: 'owner-a' }
const token = 'synthetic-credential-not-a-real-token'
function fixture() {
  let now = 1000
  let calls = 0
  let acquired = 0
  let response = () => new Response('{"id":"resource-a"}', { status: 200 })
  const control = createLocalProviderControl({
    account,
    allowedOrigins: ['https://api.example.test'],
    clock: () => now,
    operations: [
      {
        id: 'observe',
        effect: 'read',
        requiredPermissions: ['read'],
        build: (input) => ({ method: 'GET', url: `https://api.example.test/items/${input.id}` }),
      },
    ],
    credentials: {
      acquire: async () => {
        acquired++
        return token
      },
    },
    fetchImplementation: async (_, init) => {
      calls++
      assert.equal(init.headers.Authorization, `Bearer ${token}`)
      return response()
    },
  })
  const plan = control.prepare('observe', { id: 'resource-a' })
  const grant = control.approve(plan, 2000)
  return {
    control,
    plan,
    grant,
    setTime: (value) => {
      now = value
    },
    setResponse: (value) => {
      response = value
    },
    counts: () => ({ calls, acquired }),
  }
}
test('executes an exact approved request once without exporting the credential', async () => {
  const f = fixture()
  const receipt = await f.control.execute(f.grant.id, f.plan)
  assert.equal(receipt.data.id, 'resource-a')
  assert.equal(receipt.permissionState, 'not-inferred')
  assert.ok(!JSON.stringify(receipt).includes(token))
  await assert.rejects(f.control.execute(f.grant.id, f.plan), /grant\/unknown/)
})
test('concurrent use consumes only one grant', async () => {
  const f = fixture()
  const results = await Promise.allSettled([
    f.control.execute(f.grant.id, f.plan),
    f.control.execute(f.grant.id, f.plan),
  ])
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1)
  assert.deepEqual(f.counts(), { calls: 1, acquired: 1 })
})
test('rejects changed resource before credential acquisition', async () => {
  const f = fixture()
  const changed = { ...f.plan, request: { ...f.plan.request, url: 'https://api.example.test/items/other' } }
  await assert.rejects(f.control.execute(f.grant.id, changed), /plan\/changed/)
  assert.deepEqual(f.counts(), { calls: 0, acquired: 0 })
})
test('rejects expired or revoked grants before acquiring secrets', async () => {
  const f = fixture()
  f.setTime(2000)
  await assert.rejects(f.control.execute(f.grant.id, f.plan), /grant\/rejected/)
  assert.deepEqual(f.counts(), { calls: 0, acquired: 0 })
  const g = fixture()
  g.control.revoke(g.grant.id)
  await assert.rejects(g.control.execute(g.grant.id, g.plan), /grant\/unknown/)
})
test('rejects arbitrary URLs and unknown operations', () => {
  const f = fixture()
  assert.throws(() => f.control.prepare('delete', {}), /unsupported/)
  assert.throws(() => f.control.prepare('observe', { id: '#fragment' }), /url\/rejected/)
})
test('does not leak provider errors or an echoed bearer credential', async () => {
  const f = fixture()
  f.setResponse(() => new Response(JSON.stringify({ token }), { status: 200 }))
  await assert.rejects(f.control.execute(f.grant.id, f.plan), /credential-rejected/)
  const g = fixture()
  g.setResponse(() => new Response(token, { status: 403 }))
  await assert.rejects(g.control.execute(g.grant.id, g.plan), /^ProviderExecutionError: provider\/http\/403$/)
})
test('refuses redirects and oversized provider responses', async () => {
  const f = fixture()
  f.setResponse(() => new Response('', { status: 302, headers: { location: 'https://evil.test' } }))
  await assert.rejects(f.control.execute(f.grant.id, f.plan), /request\/unavailable/)
  const g = fixture()
  g.setResponse(() => new Response('x'.repeat(1048577)))
  await assert.rejects(g.control.execute(g.grant.id, g.plan), /request\/unavailable/)
})

test('rejects a bearer credential echoed using JSON Unicode escapes', async () => {
  const f = fixture()
  const escaped = [...token].map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')
  f.setResponse(() => new Response(`{"echo":"${escaped}"}`, { status: 200 }))
  await assert.rejects(f.control.execute(f.grant.id, f.plan), /credential-rejected/)
})
