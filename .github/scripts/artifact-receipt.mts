import { readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { packResult, isRecord } from './artifact-record.mts'
import type { ArtifactReceipt } from './types/artifact.mts'

// The workflow validates the source before packing; record the exact bytes without publishing.
const [input, directory] = process.argv.slice(2)
if (!input || !directory) throw new Error('usage: artifact-receipt.mts PACK_JSON OUTPUT_DIRECTORY')
const source = process.env.GITHUB_SHA
const repository = process.env.GITHUB_REPOSITORY
if (!source || !/^[a-f0-9]{40}$/.test(source) || !repository) throw new Error('missing reviewed source identity')
const json: unknown = JSON.parse(await readFile(input, 'utf8'))
const packed = packResult(json)
const manifest: unknown = JSON.parse(await readFile('package.json', 'utf8'))
if (!isRecord(manifest) || (manifest.private !== undefined && manifest.private !== false)
  || manifest.name !== packed.name || manifest.version !== packed.version) throw new Error('nonpublic package identity')
const remote = typeof manifest.repository === 'string' ? manifest.repository
  : isRecord(manifest.repository) ? manifest.repository.url : null
if (remote !== `git+https://github.com/${repository}.git`
  && remote !== `https://github.com/${repository}`) throw new Error('package repository mismatch')
const archive = resolve(directory, packed.filename)
const bytes = await readFile(archive)
if (bytes.length > 64 * 1024 * 1024) throw new Error('archive budget exceeded')
const receipt: ArtifactReceipt = {
  repository, source_sha: source, name: packed.name, version: packed.version,
  sha256: createHash('sha256').update(bytes).digest('hex'), file_count: packed.files.length,
  provenance: 'CI source and byte receipt; no npm provenance attestation or publication claimed',
}
await rename(archive, resolve(directory, 'package.tgz'))
await writeFile(resolve(directory, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n')
