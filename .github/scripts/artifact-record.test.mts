import assert from 'node:assert/strict'
import test from 'node:test'
import { packResult } from './artifact-record.mts'
const valid = { name: '@example/library', version: '0.1.0', filename: 'example-library-0.1.0.tgz',
  files: [{ path: 'package.json', size: 128 }] }

test('accepts one bounded distribution record', () => {
  assert.equal(packResult([valid]).name, valid.name)
})
test('rejects escaping archives and member paths', () => {
  assert.throws(() => packResult([{ ...valid, filename: '../outside.tgz' }]))
  assert.throws(() => packResult([{ ...valid, files: [{ path: '../outside', size: 1 }] }]))
})
test('rejects duplicate or over-budget members and multiple pack results', () => {
  assert.throws(() => packResult([{ ...valid, files: [...valid.files, ...valid.files] }]))
  assert.throws(() => packResult([{ ...valid, files: [{ path: 'large', size: 16 * 1024 * 1024 + 1 }] }]))
  assert.throws(() => packResult([valid, valid]))
})
