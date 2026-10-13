import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalProviderControl } from '../dist/local-control.mjs'

test('administrator catalog inspection is immutable and never claims observed remote rights', () => {
  let acquired = 0,
    fetched = 0
  const operation = {
    id: 'resource.write',
    effect: 'write',
    requiredPermissions: ['resource.write'],
    build: () => ({ method: 'PATCH', url: 'https://api.example.test/resource', body: '{}' }),
  }
  const control = createLocalProviderControl({
    account: { provider: 'fixture', account: 'synthetic', subject: 'owner' },
    operations: [operation],
    allowedOrigins: ['https://api.example.test'],
    credentials: {
      acquire: async () => {
        acquired++
        return 'synthetic-never-real-credential'
      },
    },
    fetchImplementation: async () => {
      fetched++
      return new Response('{}')
    },
  })
  operation.requiredPermissions.push('changed-after-registration')
  const catalog = control.describe()
  assert.equal(catalog.permissionState, 'not-observed')
  assert.deepEqual(catalog.operations[0].requiredPermissions, ['resource.write'])
  assert.ok(Object.isFrozen(catalog.operations[0]))
  assert.ok(Object.isFrozen(catalog.origins))
  assert.equal(acquired, 0)
  assert.equal(fetched, 0)
})
