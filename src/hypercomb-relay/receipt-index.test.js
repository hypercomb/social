import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReceiptIndex } from './receipt-index.js'

const sig = bytes => createHash('sha256').update(bytes).digest('hex')

test('receipt indexes are private per writer and persist atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-receipts-'))
  try {
    const bytes = Buffer.from('held')
    const signature = sig(bytes)
    writeFileSync(join(dir, signature), bytes)
    const resolve = value => value === signature ? { path: join(dir, value) } : null
    const index = new ReceiptIndex(dir, resolve)
    index.add('a'.repeat(64), [signature])
    assert.deepEqual(index.document('a'.repeat(64)).signatures, [signature])
    assert.deepEqual(index.document('b'.repeat(64)).signatures, [])
    assert.equal(readFileSync(join(dir, '.receipts', `${'a'.repeat(64)}.json`), 'utf8').includes(signature), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('boot reconciliation removes receipts whose bytes are missing or corrupt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-receipts-'))
  try {
    const owner = 'c'.repeat(64)
    const signature = 'd'.repeat(64)
    mkdirSync(join(dir, '.receipts'))
    writeFileSync(join(dir, '.receipts', `${owner}.json`), JSON.stringify({ revision: 4, signatures: [signature] }))
    const index = new ReceiptIndex(dir, () => null)
    assert.deepEqual(index.document(owner).signatures, [])
    assert.equal(index.document(owner).revision, 5)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
