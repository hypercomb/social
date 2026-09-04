// hypercomb-shared/core/packed-collect.spec.ts
//
// The collector's contract. Most of these tests exist to prove what it does
// NOT collect — a garbage collector that sweeps one live layer is worse than
// no garbage collector at all, and the failure is silent and permanent.

import { describe, expect, it } from 'vitest'
import { collect, collectSignaturesIn } from './packed-collect'
import { MemorySyncFile, PackedStoreEngine } from './packed-store-engine'

const json = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

const address = (seed: number): string =>
  seed.toString(16).padStart(8, '0').repeat(8)

describe('signature collection', () => {
  it('finds signatures at any depth, in values and arrays', () => {
    const found = new Set<string>()
    collectSignaturesIn(json({ a: address(1), b: [{ c: [address(2)] }] }), found)
    expect([...found].sort()).toEqual([address(1), address(2)].sort())
  })

  it('finds signatures used as KEYS', () => {
    // A children manifest is keyed by content signature. A key-blind scan
    // would sweep every layer such a manifest points at.
    const found = new Set<string>()
    collectSignaturesIn(json({ [address(3)]: { name: 'a tile' } }), found)
    expect([...found]).toEqual([address(3)])
  })

  it('ignores strings that merely look sig-ish, and non-JSON records', () => {
    const found = new Set<string>()
    collectSignaturesIn(json({ a: 'not a signature', b: 'abc123', c: address(1).slice(0, 63) }), found)
    expect([...found]).toEqual([])
    collectSignaturesIn(new Uint8Array([0xff, 0xd8, 0xff]), found) // a JPEG header
    expect([...found]).toEqual([])
  })
})

describe('collection', () => {
  it('sweeps content no marker ever referenced', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'a committed layer' }))
    engine.putMarkerAt(address(9), 0, json({ layer: address(1) }))
    // Litter: bytes written to get a signature, then abandoned.
    engine.putContent(address(2), json({ name: 'an abandoned paste' }))

    const collected = await collect(engine)
    expect(engine.hasContent(address(1))).toBe(true)
    expect(engine.hasContent(address(2))).toBe(false)
    expect(collected.swept).toBe(1)
    expect(collected.bytes).toBeGreaterThan(0)
  })

  it('keeps content referenced by an OLD marker, not just the head', async () => {
    // THE ONE THAT MATTERS. Reachability starts from every marker in every
    // bag, so undo and time travel survive collection. If this ever fails,
    // the collector is eating history.
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'revision one' }))
    engine.putContent(address(2), json({ name: 'revision two' }))
    engine.putMarkerAt(address(9), 0, json({ layer: address(1) }))
    engine.putMarkerAt(address(9), 1, json({ layer: address(2) }))

    await collect(engine)
    expect(engine.hasContent(address(1))).toBe(true) // superseded, still history
    expect(engine.hasContent(address(2))).toBe(true)
  })

  it('follows references transitively, to the leaves', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(3), json({ name: 'a grandchild' }))
    engine.putContent(address(2), json({ children: [address(3)] }))
    engine.putContent(address(1), json({ children: [address(2)] }))
    engine.putMarkerAt(address(9), 0, json({ layer: address(1) }))

    const collected = await collect(engine)
    expect(engine.hasContent(address(3))).toBe(true)
    expect(collected.swept).toBe(0)
  })

  it('keeps content a POOL MEMBER references — a clipboard entry is not a layer', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'a copied image' }))
    engine.putPool(address(5), 'clip', json({ image: address(1) }))

    await collect(engine)
    expect(engine.hasContent(address(1))).toBe(true)
  })

  it('collects loose blobs by the same reachability answer', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putMarkerAt(address(9), 0, json({ layer: address(1) }))
    const swept: string[] = []

    const collected = await collect(engine, {
      looseSigs: async () => [address(1), address(2)],
      sizeOfBlob: async () => 100_000,
      sweepBlob: async sig => { swept.push(sig); return true },
    })

    expect(swept).toEqual([address(2)])          // the referenced blob survives
    expect(collected.bytes).toBe(100_000)
  })

  it('sweeps nothing in an empty store, and is safe to re-run', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'live' }))
    engine.putMarkerAt(address(9), 0, json({ layer: address(1) }))

    expect((await collect(engine)).swept).toBe(0)
    expect((await collect(engine)).swept).toBe(0)
    expect(engine.hasContent(address(1))).toBe(true)
  })
})

describe('a pool member NAME is itself a reference', () => {
  it('keeps the atom a pool member names, even when its bytes hold no signature', async () => {
    // Under the molecule model a member IS an atom's address. Reading only
    // the member's BYTES left the atom unreferenced, so the sweep deleted
    // `<root>/<sig>` while the pool still named it — data loss with no
    // destructive call anywhere near the pool.
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'an atom a pool names' }))
    engine.putPool(address(7), address(1), new TextEncoder().encode('not json, no sigs inside'))

    const result = await collect(engine)

    expect(result.swept).toBe(0)
    expect(engine.getContent(address(1))).toBeTruthy()
  })

  it('still follows the member BYTES as well as the name', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'named by the member' }))
    engine.putContent(address(2), json({ name: 'referenced inside it' }))
    engine.putPool(address(7), address(1), json({ points: address(2) }))

    const result = await collect(engine)

    expect(result.swept).toBe(0)
    expect(engine.getContent(address(2))).toBeTruthy()
  })

  it('does not keep content just because SOME pool exists', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(3), json({ name: 'an abandoned paste' }))
    engine.putPool(address(7), address(1), json({}))

    const result = await collect(engine)

    expect(result.swept).toBe(1)
    expect(engine.getContent(address(3))).toBeFalsy()
  })
})


describe('wipe-safe pools — a derived cache is not a reference', () => {
  it('skips the members of a wipe-safe pool WHOLE, name and bytes, so the cache cannot pin what it derived from', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'the original image the thumbnail was derived from' }))
    engine.putContent(address(2), json({ name: 'a layer the manifest names' }))
    // a derived-cache pool: member NAMED by the source sig, bytes NAMING a layer
    engine.putPool(address(9), address(1), json({ derivedFrom: address(2) }))

    const result = await collect(engine, { wipeSafePools: new Set([address(9)]) })

    expect(result.swept).toBe(2)
    expect(engine.getContent(address(1))).toBeFalsy()
    expect(engine.getContent(address(2))).toBeFalsy()
  })

  it('an UNDECLARED pool still credits — the bias only yields to a registry that says wipe-safe', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    engine.putContent(address(1), json({ name: 'named by a member' }))
    engine.putPool(address(9), address(1), json({}))

    const result = await collect(engine, { wipeSafePools: new Set([address(8)]) })

    expect(result.swept).toBe(0)
    expect(engine.getContent(address(1))).toBeTruthy()
  })
})
