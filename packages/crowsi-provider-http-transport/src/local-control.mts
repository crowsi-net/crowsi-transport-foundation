import { randomUUID } from 'node:crypto'
import type { ProviderHttpResponse } from './contracts.mjs'
import { createProviderHttpTransport } from './index.mjs'
import { digest, prepare, verifyPlan } from './local-plan.mjs'
import type { LocalControlOptions, LocalPlan } from './local-contracts.mjs'
export type { BoundRequest, CredentialSource, LocalAccount, LocalOperation, LocalPlan } from './local-contracts.mjs'

/** Trusted owner composition. Give generated code only an execute port, never approve/credentials. */
export function createLocalProviderControl(options: LocalControlOptions) {
  if (Object.keys(options.account).sort().join(',') !== 'account,provider,subject')
    throw new Error('provider/account/invalid')
  const account = Object.freeze({ ...options.account })
  if (Object.values(account).some((value) => typeof value !== 'string' || !value || value.length > 256)) {
    throw new Error('provider/account/invalid')
  }
  const operations = [...options.operations]
  if (new Set(operations.map((item) => item.id)).size !== operations.length)
    throw new Error('provider/operation/duplicate')
  const clock = options.clock ?? Date.now
  const transport = createProviderHttpTransport({
    allowedOrigins: [...options.allowedOrigins],
    maximumRequestBytes: 65536,
    maximumResponseBytes: 1048576,
    timeoutMs: 15000,
    fetchImplementation: options.fetchImplementation,
  })
  const plans = new Map<string, LocalPlan>()
  const grants = new Map<string, { plan: LocalPlan; expires: number; issued: number }>()
  return Object.freeze({
    prepare(id: string, input: unknown) {
      if (plans.size >= 128) throw new Error('provider/plan/capacity')
      const plan = prepare(account, operations, id, input)
      // Validate destination before acquiring any credential.
      const url = new URL(plan.request.url)
      if (!options.allowedOrigins.includes(url.origin)) throw new Error('provider/destination/rejected')
      plans.set(plan.digest, plan)
      return plan
    },
    approve(plan: LocalPlan, expires: number) {
      verifyPlan(plan)
      const known = plans.get(plan.digest)
      if (!known || digest(account) !== digest(plan.account)) throw new Error('provider/plan/unknown')
      const now = clock()
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expires) || expires <= now || expires > now + 300000) {
        throw new Error('provider/grant/expiry')
      }
      if (grants.size >= 128) throw new Error('provider/grant/capacity')
      const id = randomUUID()
      grants.set(id, { plan: known, expires, issued: now })
      plans.delete(plan.digest)
      return Object.freeze({ id, digest: plan.digest, expires })
    },
    revoke(id: string) {
      grants.delete(id)
    },
    async execute(id: string, plan: LocalPlan) {
      const grant = grants.get(id)
      if (!grant) throw new Error('provider/grant/unknown')
      // Reserve synchronously: concurrent calls cannot reuse a grant; failures consume it too.
      grants.delete(id)
      verifyPlan(plan)
      const now = clock()
      if (
        !Number.isSafeInteger(now) ||
        now < grant.issued ||
        now >= grant.expires ||
        digest(grant.plan) !== digest(plan)
      ) {
        throw new Error('provider/grant/rejected')
      }
      let credential: string
      try {
        credential = await options.credentials.acquire(account)
      } catch {
        throw new Error('provider/credential/unavailable')
      }
      if (typeof credential !== 'string' || !/^[!-~]{16,16384}$/.test(credential)) {
        throw new Error('provider/credential/invalid')
      }
      if (!Number.isSafeInteger(clock()) || clock() < grant.issued || clock() >= grant.expires)
        throw new Error('provider/grant/expired')
      let response: ProviderHttpResponse
      try {
        response = await transport.request({
          ...grant.plan.request,
          headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        })
      } catch {
        throw new Error('provider/request/unavailable')
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`provider/http/${response.status}`)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(response.body)
      if (text.includes(credential)) throw new Error('provider/response/credential-rejected')
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('provider/response/not-json')
      }
      return Object.freeze({
        schema: 'crowsi://provider-operation-receipt/v1',
        operation: plan.operation,
        requestDigest: plan.digest,
        responseDigest: digest(data),
        observedAt: clock(),
        status: response.status,
        permissionState: 'not-inferred' as const,
        data,
      })
    },
  })
}

export { localCommandCredential, localKeyringCredential } from './local-credentials.mjs'
export { parameters, segment, text, labels } from './local-parameters.mjs'
