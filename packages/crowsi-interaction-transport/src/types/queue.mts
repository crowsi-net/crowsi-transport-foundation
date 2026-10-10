import type { TransportFailure } from './transport.mjs';
/** A single queued request owns its cancellation listener and deadline. */
export interface QueueItem {
  encoded: string;
  resolve(value: unknown): void;
  reject(error: TransportFailure): void;
  signal?: AbortSignal;
  abort(): void;
  timer?: ReturnType<typeof setTimeout>;
}
