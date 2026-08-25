// The resolver's contract, proved against an in-memory universe:
// closure completeness, the delta property (present files skipped but still
// mined), refusal of bytes that don't match their name, and holes reported
// rather than invented.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { resolveClosure, type ResolverIO } from './install.js'

const sig = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/** A tiny published universe: grandchild ← child ← head, plus a binary. */
const makeUniverse = () => {
  const grandchild = utf8('{"name":"leaf","children":[]}')
  const grandchildSig = sig(grandchild)
  const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe])
  const binarySig = sig(binary)
  const child = utf8(`{"name":"branch","children":["${grandchildSig}"],"image":"${binarySig}"}`)
  const childSig = sig(child)
  const head = utf8(`{"name":"site","children":["${childSig}"]}`)
  const headSig = sig(head)
  const source = new Map<string, Uint8Array>([
    [headSig, head], [childSig, child], [grandchildSig, grandchild], [binarySig, binary],
  ])
  return { headSig, childSig, grandchildSig, binarySig, source }
}

const memoryIO = (source: Map<string, Uint8Array>, disk: Map<string, Uint8Array>): ResolverIO & { fetched: string[] } => {
  const fetched: string[] = []
  return {
    fetched,
    fetch: async (s) => { fetched.push(s); return source.get(s) ?? null },
    has: (s) => disk.has(s),
    read: (s) => disk.get(s)!,
    write: (s, bytes) => { disk.set(s, bytes) },
  }
}

describe('resolveClosure', () => {
  it('resolves the full closure, sha256-verified, onto empty disk', async () => {
    const { headSig, childSig, grandchildSig, binarySig, source } = makeUniverse()
    const disk = new Map<string, Uint8Array>()
    const stats = await resolveClosure(headSig, memoryIO(source, disk))
    expect(stats.fetched).toBe(4)
    expect(stats.holes).toEqual([])
    expect(stats.refused).toEqual([])
    for (const s of [headSig, childSig, grandchildSig, binarySig]) expect(disk.has(s)).toBe(true)
  })

  it('delta: present files are not refetched but ARE mined for missing children', async () => {
    const { headSig, childSig, grandchildSig, source } = makeUniverse()
    const disk = new Map<string, Uint8Array>([
      [headSig, source.get(headSig)!],
      [childSig, source.get(childSig)!],
    ])
    const io = memoryIO(source, disk)
    const stats = await resolveClosure(headSig, io)
    expect(stats.present).toBe(2)
    expect(io.fetched).not.toContain(headSig)
    expect(io.fetched).not.toContain(childSig)
    expect(disk.has(grandchildSig)).toBe(true) // reached THROUGH the present child
  })

  it('refuses bytes that do not hash to their signature', async () => {
    const { headSig, childSig, source } = makeUniverse()
    source.set(childSig, utf8('tampered')) // a lying source
    const disk = new Map<string, Uint8Array>()
    const stats = await resolveClosure(headSig, memoryIO(source, disk))
    expect(stats.refused).toEqual([childSig])
    expect(disk.has(childSig)).toBe(false)
  })

  it('reports unreachable sigs as holes and keeps going', async () => {
    const { headSig, childSig, grandchildSig, source } = makeUniverse()
    source.delete(grandchildSig)
    const disk = new Map<string, Uint8Array>()
    const stats = await resolveClosure(headSig, memoryIO(source, disk))
    expect(stats.holes).toEqual([grandchildSig])
    expect(disk.has(headSig)).toBe(true)
    expect(disk.has(childSig)).toBe(true)
  })

  it('does not mine references out of binary payloads', async () => {
    const { binarySig, source } = makeUniverse()
    const disk = new Map<string, Uint8Array>()
    const stats = await resolveClosure(binarySig, memoryIO(source, disk))
    expect(stats.total).toBe(1)
    expect(stats.fetched).toBe(1)
  })

  it('verifyExisting refetches a corrupt on-disk file', async () => {
    const { headSig, source } = makeUniverse()
    const disk = new Map<string, Uint8Array>([[headSig, utf8('rotted on disk')]])
    const io = memoryIO(source, disk)
    const stats = await resolveClosure(headSig, io, { verifyExisting: true })
    expect(io.fetched).toContain(headSig)
    expect(stats.fetched).toBeGreaterThan(0)
    expect(new TextDecoder().decode(disk.get(headSig)!)).toContain('"site"')
  })
})
