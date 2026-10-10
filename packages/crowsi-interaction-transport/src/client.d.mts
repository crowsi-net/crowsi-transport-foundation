export interface TransportFailure extends Error { code: string }
export interface HttpTransport {
  request(payload: unknown, options?: {signal?: AbortSignal}): Promise<unknown>
  watch(payload: () => unknown, onMessage: (message: unknown) => void | Promise<void>,
    onError: (error: TransportFailure) => void | Promise<void>, options?: {intervalMs?: number; active?: () => boolean}): {stop(): Promise<void>}
}
export function createHttpTransport(options: {endpoint: string; fetch?: typeof fetch; timeoutMs?: number; maximumBytes?: number}): HttpTransport
