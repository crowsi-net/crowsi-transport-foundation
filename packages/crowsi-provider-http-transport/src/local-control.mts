import { randomUUID } from 'node:crypto'
import { createProviderHttpTransport } from './index.mjs'
import { digest, prepare, verifyPlan } from './local-plan.mjs'
import { checkedOrigins } from './policy.mjs'
import { checkedOperations } from './local-catalog.mjs'
import { executeGrant } from './local-execution.mjs'
import type { Grant } from './local-execution.mjs'
export { ProviderExecutionError } from './local-execution.mjs'
import type { LocalControlOptions, LocalPlan } from './local-contracts.mjs'
export type { BoundRequest, CredentialSource, LocalAccount, LocalOperation, LocalPlan } from './local-contracts.mjs'
/** Trusted owner composition. Give generated code only an execute port, never approve/credentials. */
export function createLocalProviderControl(options: LocalControlOptions) {
  if (Object.keys(options.account).sort().join(',') !== 'account,provider,subject')
    throw new Error('provider/account/invalid')
  const account = Object.freeze({ ...options.account })
  if (
    Object.values(account).some(
      (value) =>
        typeof value !== 'string' ||
        !value ||
        value.length > 256 ||
        value.trim() !== value ||
        [...value].some((c) => c.charCodeAt(0) < 32),
    )
  ) {
    throw new Error('provider/account/invalid')
  }
  const operations = checkedOperations(options.operations)
  const origins = checkedOrigins(options.allowedOrigins)
  if (typeof options.credentials?.acquire !== 'function') throw new Error('provider/credentials/invalid')
  const acquire = options.credentials.acquire.bind(options.credentials)
  const clock = options.clock ?? Date.now
  const transport = createProviderHttpTransport({
    allowedOrigins: [...origins],
    maximumRequestBytes: 65536,
    maximumResponseBytes: 1048576,
    timeoutMs: 15000,
    fetchImplementation: options.fetchImplementation,
  })
  const plans = new Map<string, { plan: LocalPlan; created: number }>()
  const grants = new Map<string, Grant>()
  const active = new Map<string, AbortController>()
  const prune = () => {
    const now = clock()
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('provider/clock/invalid')
    for (const [id, value] of grants) if (now < value.issued || now >= value.expires) grants.delete(id)
    for (const [id, value] of plans) if (now < value.created || now - value.created >= 300000) plans.delete(id)
    return now
  }
  return Object.freeze({
    describe() {
      return Object.freeze({
        account,
        origins: Object.freeze([...origins]),
        permissionState: 'not-observed' as const,
        operations: Object.freeze(
          operations.map(({ id, effect, requiredPermissions }) => Object.freeze({ id, effect, requiredPermissions })),
        ),
      })
    },
    prepare(id: string, input: unknown) {
      const now = prune()
      if (plans.size >= 128) throw new Error('provider/plan/capacity')
      const plan = prepare(account, operations, id, input)
      // Validate destination before acquiring any credential.
      const url = new URL(plan.request.url)
      if (!origins.has(url.origin)) throw new Error('provider/destination/rejected')
      plans.set(plan.digest, { plan, created: now })
      return plan
    },
    discard(digest: string) {
      plans.delete(digest)
    },
    approve(plan: LocalPlan, expires: number) {
      prune()
      verifyPlan(plan)
      const known = plans.get(plan.digest)
      if (!known || digest(account) !== digest(plan.account)) throw new Error('provider/plan/unknown')
      const now = clock()
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expires) || expires <= now || expires > now + 300000) {
        throw new Error('provider/grant/expiry')
      }
      if (grants.size >= 128) throw new Error('provider/grant/capacity')
      const id = randomUUID()
      grants.set(id, { plan: known.plan, expires, issued: now })
      plans.delete(plan.digest)
      return Object.freeze({ id, digest: plan.digest, expires })
    },
    revoke(id: string) {
      grants.delete(id)
      active.get(id)?.abort()
    },
    async execute(id: string, plan: LocalPlan) {
      const grant = grants.get(id)
      if (!grant) throw new Error('provider/grant/unknown')
      grants.delete(id)
      return executeGrant(id, grant, plan, account, clock, acquire, transport, active)
    },
  })
}

export { localCommandCredential, localKeyringCredential } from './local-credentials.mjs'
export { parameters, segment, text, labels } from './local-parameters.mjs'
