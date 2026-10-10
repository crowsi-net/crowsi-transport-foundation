import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const excluded = new Set(['.git', 'node_modules', 'dist'])
for (const file of readdirSync(root, { recursive: true })) {
  if (file.split(sep).some((part) => excluded.has(part))) continue
  if (!/\.(?:rs|ts|mts|cts|js|mjs|cjs|vue|css|toml|py|sh|yml|yaml)$/.test(file)) continue
  const lines = readFileSync(join(root, file), 'utf8').trimEnd().split('\n').length
  if (lines > 120) throw new Error(`${file}: ${lines} physical lines exceeds 120`)
}
console.log('Governed source/test/CI files fit the user 120 physical-line limit')
