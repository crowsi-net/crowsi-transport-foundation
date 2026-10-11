/** Cleanup must not delay an already determined transport result. */
export async function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): Promise<void> {
  if (!reader) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      reader.cancel().catch(() => {}),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 25) })
    ])
  } finally {
    clearTimeout(timer)
    // A pending read may still hold the lock; cancellation will release it later.
    try { reader.releaseLock() } catch { /* do not override the transport outcome */ }
  }
}
