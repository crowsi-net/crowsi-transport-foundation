import type { PackResult, PackFile } from './types/artifact.mts'

/** Check external npm metadata without allowing file paths to escape the artifact directory. */
export function packResult(value: unknown): PackResult {
  if (!Array.isArray(value) || value.length !== 1) throw new Error('expected one pack result')
  const record: unknown = value[0]
  if (!isRecord(record) || typeof record.name !== 'string' || typeof record.version !== 'string'
    || typeof record.filename !== 'string' || !/^[A-Za-z0-9_.-]+\.tgz$/.test(record.filename)
    || !Array.isArray(record.files) || record.files.length > 10_000) throw new Error('invalid pack metadata')
  const files: PackFile[] = record.files.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.size !== 'number'
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 16 * 1024 * 1024
      || entry.path.includes('\0') || entry.path.includes('\\') || entry.path.startsWith('/')
      || entry.path.split('/').includes('..')) throw new Error('unsafe packaged file')
    return { path: entry.path, size: entry.size }
  })
  if (files.reduce((size, file) => size + file.size, 0) > 64 * 1024 * 1024
    || new Set(files.map(file => file.path)).size !== files.length) throw new Error('invalid distribution budget')
  return { name: record.name, version: record.version, filename: record.filename, files }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
