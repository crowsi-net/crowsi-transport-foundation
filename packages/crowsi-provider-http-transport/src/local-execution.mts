import { abortable } from './abort.mjs'
import { jsonReceiptData, ResponseRejected } from './local-response.mjs'
import type { ProviderHttpResponse, ProviderHttpTransport } from './contracts.mjs'
import type { CredentialSource, LocalAccount, LocalPlan } from './local-contracts.mjs'
import { digest, verifyPlan } from './local-plan.mjs'

export interface Grant {
  plan: LocalPlan
  expires: number
  issued: number
}

/** An aborted/disconnected write may already have committed; never retry it automatically. */
export class ProviderExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'not-started' | 'not-completed' | 'indeterminate-write',
  ) {
    super(code)
    this.name = 'ProviderExecutionError'
  }
}

export async function executeGrant(
  id: string,
  grant: Grant,
  plan: LocalPlan,
  account: LocalAccount,
  clock: () => number,
  acquire: CredentialSource['acquire'],
  transport: ProviderHttpTransport,
  active: Map<string, AbortController>,
) {
  verifyPlan(plan)
  const validClock = (now: number) => Number.isSafeInteger(now) && now >= grant.issued && now < grant.expires
  const started = clock()
  if (!validClock(started) || digest(grant.plan) !== digest(plan)) throw new Error('provider/grant/rejected')
  const controller = new AbortController()
  active.set(id, controller)
  const timer = setTimeout(() => controller.abort(), Math.min(15000, grant.expires - started))
  let dispatched = false
  const error = (code: string) =>
    new ProviderExecutionError(
      code,
      dispatched ? (grant.plan.effect === 'write' ? 'indeterminate-write' : 'not-completed') : 'not-started',
    )
  const stillValid = () => {
    const now = clock()
    if (controller.signal.aborted || !validClock(now)) throw error('provider/grant/expired-or-revoked')
    return now
  }
  try {
    let credential: string
    try {
      credential = await abortable(acquire(account), controller.signal)
    } catch {
      throw error('provider/credential/unavailable')
    }
    stillValid()
    if (
      typeof credential !== 'string' ||
      credential.length < 16 ||
      credential.length > 16384 ||
      !/^[A-Za-z0-9._~+/-]+=*$/.test(credential)
    )
      throw error('provider/credential/invalid')
    let response: ProviderHttpResponse
    try {
      dispatched = true
      response = await transport.request({
        ...grant.plan.request,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      })
    } catch {
      throw error('provider/request/unavailable')
    }
    stillValid()
    if (response.status < 200 || response.status >= 300) throw error(`provider/http/${response.status}`)
    let data: unknown
    try {
      data = jsonReceiptData(response, credential)
    } catch (failure) {
      throw error(failure instanceof ResponseRejected ? failure.message : 'provider/response/rejected')
    }
    const observedAt = stillValid()
    return Object.freeze({
      schema: 'crowsi://provider-operation-receipt/v1',
      operation: plan.operation,
      requestDigest: plan.digest,
      responseDigest: digest(data),
      observedAt,
      status: response.status,
      permissionState: 'not-inferred' as const,
      data,
    })
  } finally {
    clearTimeout(timer)
    active.delete(id)
  }
}
