/** Payloads remain opaque; the host owns application schemas and authority. */
export interface RequestOptions { signal?: AbortSignal }
export interface TransportFailure extends Error { code: string }
export interface WatchOptions { intervalMs?: number; active?: () => boolean }
export interface WatchHandle { stop(): Promise<void> }
export interface HttpOptions {
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maximumBytes?: number;
}
export interface HttpTransport {
  request(payload: unknown, options?: RequestOptions): Promise<unknown>;
  watch(payload: () => unknown, onMessage: (message: unknown) => void | Promise<void>,
    onError: (error: TransportFailure) => void | Promise<void>, options?: WatchOptions): WatchHandle;
}
export interface EndpointContext { signal: AbortSignal; request: Request }
export type EndpointHandler = (payload: unknown, context: EndpointContext) => unknown | Promise<unknown>;
export interface EndpointOptions { origins: string[]; maximumBytes?: number; timeoutMs?: number }
export interface StdioOptions {
  command: string; args?: string[]; env?: NodeJS.ProcessEnv;
  timeoutMs?: number; maximumBytes?: number; maximumQueue?: number;
}
export interface StdioTransport {
  request(payload: unknown, options?: RequestOptions): Promise<unknown>;
  status(): { closed: boolean; pending: number; processes: number };
  close(): Promise<void>;
}
