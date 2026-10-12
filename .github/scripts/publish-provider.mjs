import { execFileSync } from 'node:child_process'
import { readFileSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const manifest = JSON.parse(readFileSync('package.json'))
if (!/^(?:@zixcel\/provider-(?:azure|google|cloudflare|microsoft|apple)|@crowsi\/provider-http-transport)$/.test(manifest.name) ||
    manifest.private === true || manifest.publishConfig?.access !== 'public' ||
    manifest.publishConfig?.registry !== 'https://registry.npmjs.org') throw new Error('Unexpected public package identity')
const archive = resolve(process.argv[2] ?? '')
if (!lstatSync(archive).isFile() || lstatSync(archive).size > 5242880) throw new Error('Regular bounded prepared archive required')
const bytes = readFileSync(archive), sha256 = createHash('sha256').update(bytes).digest('hex')
if (!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_ARCHIVE_SHA256 ?? '') || sha256 !== process.env.EXPECTED_ARCHIVE_SHA256) throw new Error('Prepared archive digest mismatch')
const identity = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { maxBuffer: 65536 }))
if (identity.name !== manifest.name || identity.version !== manifest.version || identity.private === true ||
    identity.publishConfig?.access !== 'public' || identity.publishConfig?.registry !== 'https://registry.npmjs.org') throw new Error('Prepared archive identity mismatch')
const review = JSON.parse(readFileSync('../../.github/reviewed-provider.json'))
if(review.name !== manifest.name || review.version !== manifest.version || review.sha256 !== sha256) throw new Error('Owner-reviewed release binding mismatch')
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`,
 { signal: AbortSignal.timeout(15000), redirect: 'error' })
if (response.ok) {
 const official = await response.json()
 if (official.name !== manifest.name || official.version !== manifest.version ||
     official.dist?.integrity !== integrity || !official.dist?.attestations?.url) throw new Error('Immutable official version mismatch')
 console.log(JSON.stringify({ name: manifest.name, version: manifest.version, state: 'existing-official-archive-matches', newOIDCPublication: false }))
} else if (response.status === 404) {
 if (process.argv.includes('--verify-existing')) throw new Error('Existing official version required; publication disabled')
 execFileSync('npm', ['publish', archive, '--access', 'public', '--provenance', '--ignore-scripts'], { stdio: 'inherit' })
} else throw new Error(`Registry version lookup failed: ${response.status}`)
console.log(JSON.stringify({ name: manifest.name, version: manifest.version, sha256 }))
