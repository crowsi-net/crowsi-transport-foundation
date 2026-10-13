import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalProviderControl } from '../dist/local-control.mjs'

const account = { provider: 'fixture', account: 'fixture-account', subject: 'fixture-owner' }
const token = 'synthetic-token-never-used-for-an-account'
const operation = {
  id: 'resource.write',
  effect: 'write',
  requiredPermissions: ['resource.write'],
  build: () => ({ method: 'PATCH', url: 'https://api.example.test/resource', body: '{}' }),
}
function fixture(overrides = {}) {
  return createLocalProviderControl({
    account,
    operations: [operation],
    allowedOrigins: ['https://api.example.test'],
    credentials: { acquire: async () => token },
    clock: () => 1000,
    fetchImplementation: async () => new Response(null, { status: 204 }),
    ...overrides,
  })
}
function granted(control) {
  const plan = control.prepare(operation.id, {})
  return { plan, grant: control.approve(plan, 2000) }
}

test('successful no-content writes produce a receipt instead of suggesting a retry', async () => {
  const control = fixture(),
    { plan, grant } = granted(control)
  const receipt = await control.execute(grant.id, plan)
  assert.equal(receipt.status, 204)
  assert.equal(receipt.data, null)
  await assert.rejects(control.execute(grant.id, plan), /grant\/unknown/)
})

test('revocation during credential acquisition prevents dispatch', async () => {
  let finish,
    calls = 0
  const control = fixture({
    credentials: {
      acquire: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    },
    fetchImplementation: async () => {
      calls++
      return new Response('{}')
    },
  })
  const { plan, grant } = granted(control),
    execution = control.execute(grant.id, plan)
  control.revoke(grant.id)
  await assert.rejects(execution, (error) => error.outcome === 'not-started')
  finish(token)
  await Promise.resolve()
  assert.equal(calls, 0)
})

test('revocation during a write aborts logical waiting and reports an indeterminate outcome', async () => {
  let started
  const reachedFetch = new Promise((resolve) => {
    started = resolve
  })
  const control = fixture({
    fetchImplementation: async () => {
      started()
      return new Promise(() => {})
    },
  })
  const { plan, grant } = granted(control),
    execution = control.execute(grant.id, plan)
  await reachedFetch
  control.revoke(grant.id)
  await assert.rejects(execution, (error) => error.outcome === 'indeterminate-write')
})

test('expiry while receiving a response never produces a successful write receipt', async () => {
  let now = 1000
  const control = fixture({
    clock: () => now,
    fetchImplementation: async () => {
      now = 2000
      return new Response('{}')
    },
  })
  const { plan, grant } = granted(control)
  await assert.rejects(control.execute(grant.id, plan), (error) => error.outcome === 'indeterminate-write')
})

test('registration mutation cannot broaden destinations or change declared effects', () => {
  const origins = ['https://api.example.test'],
    mutable = { ...operation },
    operations = [mutable]
  const control = fixture({ allowedOrigins: origins, operations })
  origins.push('https://unapproved.example.test')
  mutable.effect = 'read'
  mutable.build = () => ({ method: 'GET', url: 'https://unapproved.example.test/resource' })
  operations.push({ ...mutable, id: 'unapproved' })
  const plan = control.prepare(operation.id, {})
  assert.equal(plan.effect, 'write')
  assert.equal(new URL(plan.request.url).origin, 'https://api.example.test')
  assert.throws(() => control.prepare('unapproved', {}), /operation\/unsupported/)
})

test('discarded or stale plans cannot be approved', () => {
  let now = 1000
  const control = fixture({ clock: () => now }),
    plan = control.prepare(operation.id, {})
  control.discard(plan.digest)
  assert.throws(() => control.approve(plan, 2000), /plan\/unknown/)
  const next = control.prepare(operation.id, {})
  now += 300000
  assert.throws(() => control.approve(next, now + 1000), /plan\/unknown/)
})
