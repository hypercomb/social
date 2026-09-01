// replication-walker.spec.ts — the shell-embedded replication client.
// Pure io mocks: a Map heap, a Map origin. Signatures are real sha256 of the
// bytes, so verification paths are exercised for real.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { isComplete, mineSignatures, resolveInventory, resolveSignatureClosure, type ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

type World = {
  heap: Map<string, Uint8Array<ArrayBuffer>>
  origin: Map<string, Uint8Array<ArrayBuffer>>
  io: ReplicationIo
  fetches: string[]
}

const world = (): World => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const origin = new Map<string, Uint8Array<ArrayBuffer>>()
  const fetches: string[] = []
  const io: ReplicationIo = {
    read: async (sig) => heap.get(sig) ?? null,
    fetch: async (sig) => { fetches.push(sig); return origin.get(sig) ?? null },
    write: async (sig, bytes) => { heap.set(sig, bytes) },
  }
  return { heap, origin, io, fetches }
}

/** An atom whose text names the given child signatures. */
const atomNaming = (children: string[]): Uint8Array<ArrayBuffer> =>
  encode(JSON.stringify({ children }))

describe('replication walker', () => {

  it('resolves a closure: fetches, verifies, admits, and walks named children', async () => {
    const w = world()
    const leafA = encode('leaf a')
    const leafB = encode('leaf b')
    const sigA = await sigOf(leafA)
    const sigB = await sigOf(leafB)
    const rootBytes = atomNaming([sigA, sigB])
    const root = await sigOf(rootBytes)
    w.origin.set(root, rootBytes).set(sigA, leafA).set(sigB, leafB)

    const result = await resolveSignatureClosure(root, w.io)
    expect(isComplete(result)).toBe(true)
    expect(result.fetched).toBe(3)
    expect(result.present).toBe(0)
    expect(new Set(result.held)).toEqual(new Set([root, sigA, sigB]))
    expect(w.heap.size).toBe(3)
  })

  it('is an idempotent delta repair: present atoms are reused, only the gap fetches', async () => {
    const w = world()
    const leafA = encode('leaf a')
    const leafB = encode('leaf b')
    const sigA = await sigOf(leafA)
    const sigB = await sigOf(leafB)
    const rootBytes = atomNaming([sigA, sigB])
    const root = await sigOf(rootBytes)
    w.origin.set(root, rootBytes).set(sigA, leafA).set(sigB, leafB)
    w.heap.set(root, rootBytes).set(sigA, leafA)   // sigB is the hole to repair

    const result = await resolveSignatureClosure(root, w.io)
    expect(isComplete(result)).toBe(true)
    expect(result.present).toBe(2)
    expect(result.fetched).toBe(1)
    expect(w.fetches).toEqual([sigB])
  })

  it('refuses origin bytes that do not hash to their name — nothing is admitted', async () => {
    const w = world()
    const good = encode('good leaf')
    const sigGood = await sigOf(good)
    const rootBytes = atomNaming([sigGood])
    const root = await sigOf(rootBytes)
    w.origin.set(root, rootBytes)
    w.origin.set(sigGood, encode('EVIL SUBSTITUTE'))   // poisoned origin

    const result = await resolveSignatureClosure(root, w.io)
    expect(isComplete(result)).toBe(false)
    expect(result.refused).toEqual([sigGood])
    expect(w.heap.has(sigGood)).toBe(false)
  })

  it('reports unreachable signatures as holes and keeps walking the rest', async () => {
    const w = world()
    const leafA = encode('reachable')
    const sigA = await sigOf(leafA)
    const sigMissing = 'a'.repeat(64)
    const rootBytes = atomNaming([sigA, sigMissing])
    const root = await sigOf(rootBytes)
    w.origin.set(root, rootBytes).set(sigA, leafA)

    const result = await resolveSignatureClosure(root, w.io)
    expect(result.holes).toEqual([sigMissing])
    expect(result.held).toContain(sigA)
    expect(isComplete(result)).toBe(false)
  })

  it('re-verifies local reads: a corrupted heap entry is refetched, not trusted', async () => {
    const w = world()
    const leaf = encode('true bytes')
    const sig = await sigOf(leaf)
    w.origin.set(sig, leaf)
    w.heap.set(sig, encode('rotted bytes'))   // heap lies

    const result = await resolveInventory(sig, [sig], w.io)
    expect(result.fetched).toBe(1)
    expect(result.present).toBe(0)
    expect(w.heap.get(sig)).toEqual(leaf)
  })

  it('honours the limit and reports the walk as limited', async () => {
    const w = world()
    const leafA = encode('leaf a')
    const sigA = await sigOf(leafA)
    const rootBytes = atomNaming([sigA])
    const root = await sigOf(rootBytes)
    w.origin.set(root, rootBytes).set(sigA, leafA)

    const result = await resolveSignatureClosure(root, w.io, { limit: 1 })
    expect(result.limited).toBe(true)
    expect(isComplete(result)).toBe(false)
    expect(result.total).toBe(1)
  })

  it('inventory mode fetches exactly the enumerated set — no mining, no recursion', async () => {
    const w = world()
    const named = encode('named leaf')
    const sigNamed = await sigOf(named)
    const carrier = atomNaming([sigNamed])       // names another atom…
    const sigCarrier = await sigOf(carrier)
    w.origin.set(sigCarrier, carrier).set(sigNamed, named)

    const result = await resolveInventory(sigCarrier, [sigCarrier], w.io)
    expect(isComplete(result)).toBe(true)
    expect(result.total).toBe(1)                  // …but the inventory does not follow it
    expect(w.heap.has(sigNamed)).toBe(false)
  })

  it('mines only literal 64-hex identities from text atoms; binary atoms are leaves', async () => {
    const sig = 'b'.repeat(64)
    expect(mineSignatures(encode(`{"cell":"${sig}"}`))).toEqual([sig])
    expect(mineSignatures(new Uint8Array([0xff, 0xfe, 0x00, 0x81]))).toEqual([])
  })
})
