import type { createLocalProviderControl } from './local-control.mjs'
import type { LocalPlan } from './local-contracts.mjs'
import { verifyPlan } from './local-plan.mjs'

type Control = Pick<ReturnType<typeof createLocalProviderControl>, 'execute' | 'revoke'>
type Permit = { readonly id: string; readonly digest: string; readonly expires: number }

/** Owner composition: only handle crosses the generated-code boundary. */
export function createExecutePort(control: Control, clock: () => number = Date.now) {
  const permits = new Map<string, { plan: LocalPlan; permit: Permit }>()
  const prune = () => {
    const now = clock()
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('provider/execute-port/clock')
    for (const [id, value] of permits) if (now >= value.permit.expires) permits.delete(id)
    return now
  }
  return Object.freeze({
    register(plan: LocalPlan, permit: Permit) {
      const now = prune()
      verifyPlan(plan)
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(permit.id) ||
        permit.digest !== plan.digest ||
        !Number.isSafeInteger(permit.expires) ||
        permit.expires <= now ||
        permit.expires > now + 300000 ||
        permits.has(permit.id) ||
        permits.size >= 128
      )
        throw new Error('provider/execute-port/registration')
      permits.set(permit.id, { plan: structuredClone(plan), permit: Object.freeze({ ...permit }) })
      return Object.freeze({ grantId: permit.id, requestDigest: plan.digest })
    },
    revoke(id: string) {
      permits.delete(id)
      control.revoke(id)
    },
    async handle(input: unknown) {
      prune()
      if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype)
        throw new Error('provider/execute-port/rejected')
      const value = input as Record<string, unknown>
      if (
        Object.keys(value).sort().join(',') !== 'grantId,requestDigest' ||
        typeof value.grantId !== 'string' ||
        typeof value.requestDigest !== 'string' ||
        value.grantId.length !== 36 ||
        !/^[a-f0-9]{64}$/.test(value.requestDigest)
      )
        throw new Error('provider/execute-port/rejected')
      const known = permits.get(value.grantId)
      if (!known || known.plan.digest !== value.requestDigest) throw new Error('provider/execute-port/rejected')
      permits.delete(value.grantId)
      return control.execute(known.permit.id, known.plan)
    },
  })
}
