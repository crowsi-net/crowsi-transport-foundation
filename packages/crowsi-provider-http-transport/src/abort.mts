import { ProviderTransportError } from './policy.mjs'

/** Settle logical waiting on abort without requiring the injected operation to cooperate. */
export function abortable<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      reject(new ProviderTransportError('transport/request/aborted'))
    }
    Promise.resolve(operation).then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

/** Best-effort cleanup must not block transport completion. */
export function cancelBody(response: Response | undefined): void {
  // Cleanup is best effort: an injected stream's cancel hook must not block the result.
  try {
    void response?.body?.cancel().catch(() => {})
  } catch {
    /* A closed or locked stream needs no further cleanup. */
  }
}
