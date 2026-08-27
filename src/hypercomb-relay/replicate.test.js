import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  contentDirectoryIO,
  parseReplicationRequest,
  resolveSignatureClosure,
} from './replicate.js'

const sig = bytes => createHash('sha256').update(bytes).digest('hex')

test('replicates and verifies an atomic closure, then becomes a delta no-op', async () => {
  const leaf = Buffer.from('image bytes')
  const leafSig = sig(leaf)
  const root = Buffer.from(JSON.stringify({ imageSig: leafSig }))
  const rootSig = sig(root)
  const source = new Map([[rootSig, root], [leafSig, leaf]])
  const destination = new Map()
  const io = {
    fetch: async signature => source.get(signature) ?? null,
    read: async signature => destination.get(signature) ?? null,
    write: async (signature, bytes) => { destination.set(signature, bytes) },
  }

  const first = await resolveSignatureClosure(rootSig, io)
  assert.equal(first.fetched, 2)
  assert.deepEqual(first.holes, [])
  assert.deepEqual(first.refused, [])

  const second = await resolveSignatureClosure(rootSig, io)
  assert.equal(second.present, 2)
  assert.equal(second.fetched, 0)
})

test('refuses bytes that do not match their requested signature', async () => {
  const claimed = 'a'.repeat(64)
  const result = await resolveSignatureClosure(claimed, {
    fetch: async () => Buffer.from('wrong'),
    read: async () => null,
    write: async () => assert.fail('unverified bytes must never be written'),
  })
  assert.deepEqual(result.refused, [claimed])
})

test('flat destination writes atoms under their signature', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-replicator-'))
  try {
    const bytes = Buffer.from('one atom')
    const signature = sig(bytes)
    const io = contentDirectoryIO(dir, [])
    await io.write(signature, bytes)
    assert.deepEqual(readFileSync(join(dir, signature)), bytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flat destination repairs a corrupt existing atom', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-replicator-'))
  try {
    const bytes = Buffer.from('correct atom')
    const signature = sig(bytes)
    const io = contentDirectoryIO(dir, [])
    await io.write(signature, Buffer.from('corrupt'))
    await io.write(signature, bytes)
    assert.deepEqual(readFileSync(join(dir, signature)), bytes)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('normalizes the signature-only request contract', () => {
  const request = parseReplicationRequest({
    signature: 'A'.repeat(64),
    sources: ['https://content.example/', 'https://content.example'],
  })
  assert.equal(request.signature, 'a'.repeat(64))
  assert.deepEqual(request.sources, ['https://content.example'])
})

test('rejects credential-bearing source URLs', () => {
  assert.throws(() => parseReplicationRequest({
    signature: 'a'.repeat(64),
    sources: ['https://secret@example.test'],
  }), /credentials/)
})
