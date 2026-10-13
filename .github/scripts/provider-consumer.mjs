import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const producer = join(source, 'packages/crowsi-provider-http-transport')
const root = mkdtempSync(join(tmpdir(), 'crowsi-provider-consumer-'))
writeFileSync(join(root, 'user.npmrc'), '')
writeFileSync(join(root, 'global.npmrc'), '')
const env = { ...process.env, NPM_CONFIG_USERCONFIG: join(root, 'user.npmrc'),
  NPM_CONFIG_GLOBALCONFIG: join(root, 'global.npmrc'), NPM_CONFIG_CACHE: join(root, 'cache'),
  NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org', NODE_AUTH_TOKEN: '', NPM_TOKEN: '' }
function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
try {
  const rows = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--workspaces=false', '--json', '--pack-destination', root], producer))
  const packed = (Array.isArray(rows) ? rows : Object.values(rows))[0]
  assert.equal(packed.name, '@crowsi/provider-http-transport')
  assert.equal(packed.filename, packed.filename.split('/').at(-1))
  const consumer = join(root, 'consumer')
  mkdirSync(consumer)
  writeFileSync(join(consumer, '.npmrc'), 'registry=https://registry.npmjs.org/\n')
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  const manifest = JSON.parse(readFileSync(join(producer, 'package.json'), 'utf8'))
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false',
    join(root, packed.filename), `typescript@${manifest.devDependencies.typescript}`,
    `@types/node@${manifest.devDependencies['@types/node']}`], consumer)
  cpSync(join(source, '.github/fixtures/provider-consumer.mts'), join(consumer, 'consumer.mts'))
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'consumer.mts'], consumer)
  cpSync(join(source, 'playground/local-control/demo.mjs'), join(consumer, 'consumer.mjs'))
  process.stdout.write(run(process.execPath, ['consumer.mjs'], consumer))
  cpSync(join(source, 'playground/execute-port/demo.mjs'), join(consumer, 'execute-port.mjs'))
  process.stdout.write(run(process.execPath, ['execute-port.mjs'], consumer))
  if (process.env.CROWSI_WORKLOAD_HELPER) {
    cpSync(join(source, 'playground/native-execute-port/verify.mjs'), join(consumer, 'native-execute-port.mjs'))
    process.stdout.write(run(process.execPath, ['native-execute-port.mjs'], consumer))
  }
  console.log('Provider archive consumer: public types, read/write/read-back, replay and secret rejection passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
