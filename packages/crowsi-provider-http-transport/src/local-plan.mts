import { createHash } from 'node:crypto'
import type { LocalAccount, LocalOperation, LocalPlan } from './local-contracts.mjs'

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
export function prepare(
  account: LocalAccount,
  operations: readonly LocalOperation[],
  id: string,
  input: unknown,
): LocalPlan {
  const operation = operations.find((item) => item.id === id)
  if (!operation) throw new Error('provider/operation/unsupported')
  const built = operation.build(structuredClone(input), account)
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(built.method)) throw new Error('provider/method/rejected')
  if (built.method === 'GET' && built.body !== undefined) throw new Error('provider/body/rejected')
  if (built.body !== undefined && (typeof built.body !== 'string' || Buffer.byteLength(built.body) > 65536)) {
    throw new Error('provider/body/rejected')
  }
  const url = new URL(built.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('provider/url/rejected')
  const request = Object.freeze({ url: url.href, method: built.method, ...(built.body ? { body: built.body } : {}) })
  const value = {
    schema: 'crowsi://provider-operation-plan/v1' as const,
    account: Object.freeze({ ...account }),
    operation: id,
    effect: operation.effect,
    requiredPermissions: Object.freeze([...operation.requiredPermissions]),
    request,
  }
  return Object.freeze({ ...value, digest: digest(value) })
}
export function verifyPlan(plan: LocalPlan): void {
  const { digest: expected, ...value } = plan
  if (digest(value) !== expected) throw new Error('provider/plan/changed')
}
