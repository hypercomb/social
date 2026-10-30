// hive-entrance.spec.ts — an entrance names a hive by signature; the document
// is hashed against it, so only the bytes that signature names are ever a hive.

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { handOffHive, hiveSignatureOf, readHiveEntrance } from './hive-entrance'

const doc = { package: 'a'.repeat(64), core: 'b'.repeat(64), arrival: ['ViewBee'] }
const bytes = new TextEncoder().encode(JSON.stringify(doc))
const sig = createHash('sha256').update(bytes).digest('hex')

const serving = (body: Uint8Array, ok = true) => async () =>
  ({ ok, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }) as unknown as Response

describe('hive entrance', () => {
  afterEach(() => { delete (globalThis as { __hcHive?: unknown }).__hcHive })

  it('reads the hive signature a visit names, only if it is one', () => {
    expect(hiveSignatureOf(`?hive=${sig.toUpperCase()}`)).toBe(sig)
    expect(hiveSignatureOf('?hive=ViewBee')).toBeNull()
    expect(hiveSignatureOf('?other=1')).toBeNull()
    expect(hiveSignatureOf('')).toBeNull()
  })

  it('returns the document when its bytes hash to the signature', async () => {
    expect(await readHiveEntrance(`?hive=${sig}`, serving(bytes))).toEqual(doc)
  })

  it('refuses bytes that do not hash to the signature', async () => {
    const forged = new TextEncoder().encode(JSON.stringify({ ...doc, arrival: ['Everything'] }))
    expect(await readHiveEntrance(`?hive=${sig}`, serving(forged))).toBeNull()
  })

  it('is no hive when the fetch fails, is refused or returns garbage', async () => {
    expect(await readHiveEntrance(`?hive=${sig}`, serving(bytes, false))).toBeNull()
    expect(await readHiveEntrance(`?hive=${sig}`, async () => { throw new Error('offline') })).toBeNull()
    const junk = new TextEncoder().encode('not json')
    const junkSig = createHash('sha256').update(junk).digest('hex')
    expect(await readHiveEntrance(`?hive=${junkSig}`, serving(junk))).toBeNull()
  })

  it('sets the hand-off only for a visit that names a hive', () => {
    handOffHive('')
    expect((globalThis as { __hcHive?: unknown }).__hcHive).toBeUndefined()
    handOffHive(`?hive=${sig}`)
    expect((globalThis as { __hcHive?: unknown }).__hcHive).toBeInstanceOf(Promise)
  })
})
