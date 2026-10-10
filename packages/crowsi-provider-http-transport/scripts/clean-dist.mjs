import { rmSync } from 'node:fs'
// Only generated output in this package is removed; typed source is authoritative.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true })
