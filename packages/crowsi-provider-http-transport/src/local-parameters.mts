export function parameters(input: unknown, required: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error('provider/input/invalid')
  }
  const record = input as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== [...required].sort().join(',')) throw new Error('provider/input/fields')
  return record
}
export function segment(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('provider/input/identifier')
  return value
}
export function text(value: unknown, maximum = 64): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error('provider/input/text')
  }
  return value
}
export function labels(value: unknown): Record<string, string> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('provider/input/labels')
  }
  const entries = Object.entries(value)
  if (entries.length > 32) throw new Error('provider/input/labels')
  for (const [key, item] of entries) {
    if (!/^[a-z][a-z0-9_-]{0,62}$/.test(key) || typeof item !== 'string' || !/^[a-z0-9_-]{0,63}$/.test(item)) {
      throw new Error('provider/input/labels')
    }
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}
