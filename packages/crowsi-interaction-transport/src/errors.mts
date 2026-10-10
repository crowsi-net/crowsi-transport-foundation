/** Stable transport failures never expose subprocess diagnostics or host secrets. */
export class TransportError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'TransportError'; this.code = code; }
}
