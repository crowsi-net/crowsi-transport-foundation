import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'interaction-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).slice(-3000)}`);
}
try {
  const producer = resolve('packages/crowsi-interaction-transport');
  run('npm', ['pack', '--workspaces=false', '--ignore-scripts', '--pack-destination', root], producer);
  const archive = join(root, readdirSync(root).find(name => name.endsWith('.tgz')));
  const consumer = join(root, 'consumer');
  run('mkdir', [consumer], root);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive, 'typescript@5.9.3', '@types/node@24.12.0'], consumer);
  writeFileSync(join(consumer, 'consumer.mts'), `import {createHttpTransport, type HttpTransport, type TransportFailure} from '@crowsi/interaction-transport/client';
const transport: HttpTransport = createHttpTransport({endpoint:'/api/interaction'});
function onError(error: TransportFailure): string { return error.code; }
void transport; void onError;
`);
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'consumer.mts'], consumer);
  writeFileSync(join(consumer, 'runtime.mjs'), `import assert from 'node:assert/strict';
import {createHttpTransport} from '@crowsi/interaction-transport/client';
const transport = createHttpTransport({endpoint:'/api/interaction',fetch:async () => Response.json({ok:true})});
assert.deepEqual(await transport.request({}), {ok:true});
`);
  run(process.execPath, ['runtime.mjs'], consumer);
  console.log('Independent TGZ consumer: strict public types and HTTP runtime passed');
} finally { rmSync(root, { recursive: true, force: true }); }
