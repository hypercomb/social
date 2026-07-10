// layer-placement.spec.ts — the strict/non-strict children reads that
// membership SETs (paste, cut, move, promote, copy, /layout apply) depend
// on. The contract under test: childNamesOf drops unresolvable sigs
// SILENTLY (read-only render paths only); childNamesOfStrict reports the
// cold miss so writers can refuse instead of wiping the sibling.

import { describe, expect, it } from 'vitest'
import { captureCollectionSig, childEntriesOf, childNamesOf, childNamesOfStrict, flattenLayerTree, type PlacementHistory, type PlacementLayer } from './layer-placement.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)

const historyWith = (layers: Record<string, PlacementLayer | null>): PlacementHistory => ({
  sign: async () => 'x'.repeat(64),
  currentLayerAt: async () => null,
  commitLayer: async () => 'x'.repeat(64),
  getLayerBySig: async (sig: string) => layers[sig] ?? null,
} as unknown as PlacementHistory)

describe('childNamesOfStrict', () => {
  it('resolves every warm child with no cold miss', async () => {
    const history = historyWith({
      [SIG_A]: { name: 'alpha' },
      [SIG_B]: { name: 'beta' },
    })
    const { names, coldMiss } = await childNamesOfStrict(history, { name: 'parent', children: [SIG_A, SIG_B] })
    expect(names).toEqual(['alpha', 'beta'])
    expect(coldMiss).toBe(false)
  })

  it('reports coldMiss when a child sig fails to resolve — the wipe guard', async () => {
    const history = historyWith({
      [SIG_A]: { name: 'alpha' },
      [SIG_B]: null,               // cold: bytes not warm, tile still real
      [SIG_C]: { name: 'gamma' },
    })
    const { names, coldMiss } = await childNamesOfStrict(history, { name: 'parent', children: [SIG_A, SIG_B, SIG_C] })
    expect(names).toEqual(['alpha', 'gamma'])
    expect(coldMiss).toBe(true)     // caller MUST refuse to SET children
  })

  it('empty and null parents are complete, not cold', async () => {
    const history = historyWith({})
    expect(await childNamesOfStrict(history, { name: 'leaf' })).toEqual({ names: [], coldMiss: false })
    expect(await childNamesOfStrict(history, null)).toEqual({ names: [], coldMiss: false })
  })

  it('children manifest rescues bytes-cold children — no cold miss, order kept', async () => {
    // The root-of-a-large-hive case: the renderer displays via the
    // manifest while the child layer bytes are cold; membership writers
    // must resolve the same names instead of refusing.
    const history = historyWith({ [SIG_A]: { name: 'alpha' } })
    history.childrenManifestFor = async () => [
      { sig: SIG_A, layer: { name: 'alpha' } },
      { sig: SIG_B, layer: { name: 'beta' } },
      { sig: SIG_C, layer: { name: 'gamma' } },
    ]
    const { names, coldMiss } = await childNamesOfStrict(history, { name: 'root', children: [SIG_A, SIG_B, SIG_C] })
    expect(names).toEqual(['alpha', 'beta', 'gamma'])
    expect(coldMiss).toBe(false)
  })

  it('still cold when a child is missing from BOTH bytes and manifest', async () => {
    const history = historyWith({ [SIG_A]: { name: 'alpha' } })
    history.childrenManifestFor = async () => [
      { sig: SIG_A, layer: { name: 'alpha' } },
      // SIG_B absent from the manifest too
    ]
    const { names, coldMiss } = await childNamesOfStrict(history, { name: 'root', children: [SIG_A, SIG_B] })
    expect(names).toEqual(['alpha'])
    expect(coldMiss).toBe(true)
  })

  it('manifest is consulted FIRST — a covering manifest costs zero per-child byte reads', async () => {
    // The perf contract: on a big bytes-cold page (the root of a real
    // hive) the old bytes-first order probed N cold fallback chains
    // before the manifest. One manifest read must replace them all.
    let byteReads = 0
    const history = historyWith({ [SIG_A]: { name: 'alpha' }, [SIG_B]: { name: 'beta' } })
    const inner = history.getLayerBySig
    history.getLayerBySig = async (sig: string) => { byteReads++; return inner(sig) }
    history.childrenManifestFor = async () => [
      { sig: SIG_A, layer: { name: 'alpha' } },
      { sig: SIG_B, layer: { name: 'beta' } },
    ]
    const { names, coldMiss } = await childNamesOfStrict(history, { name: 'root', children: [SIG_A, SIG_B] })
    expect(names).toEqual(['alpha', 'beta'])
    expect(coldMiss).toBe(false)
    expect(byteReads).toBe(0)
  })
})

describe('flattenLayerTree', () => {
  it('re-homes a bytes-cold child via the manifest instead of silently dropping it', async () => {
    // The pasted-subtree-loses-tiles case: the child layer bytes are
    // cold but the parent's manifest inlines the full child layer —
    // the re-home must carry it (name, props slot verbatim).
    const PROPS = 'f'.repeat(64)
    const history = historyWith({ [SIG_A]: { name: 'warm', children: [] } })
    history.childrenManifestFor = async (layer: PlacementLayer) =>
      layer.name === 'top'
        ? [
            { sig: SIG_A, layer: { name: 'warm', children: [] } },
            { sig: SIG_B, layer: { name: 'cold-child', children: [], properties: [PROPS] } },
          ]
        : null
    const updates = await flattenLayerTree(history, { name: 'top', children: [SIG_A, SIG_B] }, ['dest'])
    const paths = updates.map(u => u.segments.join('/'))
    expect(paths).toEqual(['dest', 'dest/warm', 'dest/cold-child'])
    const top = updates[0].layer as { children?: string[] }
    expect(top.children).toEqual(['warm', 'cold-child'])
    const cold = updates[2].layer as { properties?: string[] }
    expect(cold.properties).toEqual([PROPS])  // slots ride verbatim — the image survives
  })

  it('still drops a child missing from BOTH bytes and manifest', async () => {
    const history = historyWith({ [SIG_A]: { name: 'warm', children: [] } })
    history.childrenManifestFor = async () => [{ sig: SIG_A, layer: { name: 'warm', children: [] } }]
    const updates = await flattenLayerTree(history, { name: 'top', children: [SIG_A, SIG_B] }, ['dest'])
    expect(updates.map(u => u.segments.join('/'))).toEqual(['dest', 'dest/warm'])
  })
})

describe('childNamesOf (non-strict, read-only paths)', () => {
  it('silently drops cold children — why writers must never use it', async () => {
    const history = historyWith({ [SIG_A]: { name: 'alpha' }, [SIG_B]: null })
    const names = await childNamesOf(history, { name: 'parent', children: [SIG_A, SIG_B] })
    expect(names).toEqual(['alpha'])  // no signal that beta existed
  })
})

// -------------------------------------------------
// childEntriesOf — the sig-level membership read the delta commits use.
// Manifest-first (one pool read covers the parent); `missing` counts
// unresolvable children so collision checks can tell "no collision"
// from "can't see" — but NOTHING is wiped on a miss, because delta
// commits never re-list the slot.
// -------------------------------------------------

describe('childEntriesOf', () => {
  it('pairs every child sig with its name, manifest-first at zero byte reads', async () => {
    let byteReads = 0
    const history = historyWith({ [SIG_A]: { name: 'alpha' }, [SIG_B]: { name: 'beta' } })
    const inner = history.getLayerBySig
    history.getLayerBySig = async (sig: string) => { byteReads++; return inner(sig) }
    history.childrenManifestFor = async () => [
      { sig: SIG_A, layer: { name: 'alpha' } },
      { sig: SIG_B, layer: { name: 'beta' } },
    ]
    const { entries, missing } = await childEntriesOf(history, { name: 'root', children: [SIG_A, SIG_B] })
    expect(entries).toEqual([{ sig: SIG_A, name: 'alpha' }, { sig: SIG_B, name: 'beta' }])
    expect(missing).toBe(0)
    expect(byteReads).toBe(0)
  })

  it('falls back to byte reads per child when the manifest is absent', async () => {
    const history = historyWith({ [SIG_A]: { name: 'alpha' }, [SIG_B]: { name: 'beta' } })
    const { entries, missing } = await childEntriesOf(history, { name: 'root', children: [SIG_A, SIG_B] })
    expect(entries.map(e => e.name)).toEqual(['alpha', 'beta'])
    expect(missing).toBe(0)
  })

  it('counts children missing from BOTH sources instead of dropping them silently', async () => {
    const history = historyWith({ [SIG_A]: { name: 'alpha' }, [SIG_B]: null })
    const { entries, missing } = await childEntriesOf(history, { name: 'root', children: [SIG_A, SIG_B] })
    expect(entries).toEqual([{ sig: SIG_A, name: 'alpha' }])
    expect(missing).toBe(1)
  })

  it('empty and null parents are empty with nothing missing', async () => {
    const history = historyWith({})
    expect(await childEntriesOf(history, { name: 'leaf' })).toEqual({ entries: [], missing: 0 })
    expect(await childEntriesOf(history, null)).toEqual({ entries: [], missing: 0 })
  })
})

// -------------------------------------------------
// captureCollectionSig — the sig-at-intent primitive behind cut/copy.
// Seal FIRST (live merkle fold — per-page history leaves the parent's
// stored child sig stale for deep edits), stored sig as fallback, and a
// parent-chain read as the last resort for sig-less legacy entries.
// -------------------------------------------------

describe('captureCollectionSig', () => {
  it('prefers the sealed live fold over the stored (possibly stale) sig', async () => {
    const history = historyWith({})
    history.sealSubtree = async () => SIG_C
    expect(await captureCollectionSig(history, ['page', 'payload'], SIG_A)).toBe(SIG_C)
  })

  it('falls back to the stored sig when the seal refuses (cold branch)', async () => {
    const history = historyWith({})
    history.sealSubtree = async () => null
    expect(await captureCollectionSig(history, ['page', 'payload'], SIG_A)).toBe(SIG_A)
  })

  it('resolves through the parent chain when there is no seal and no stored sig', async () => {
    const history = historyWith({ [SIG_B]: { name: 'payload', children: [] } })
    const locFor = (segs: readonly string[]) => 'loc:' + segs.join('/')
    history.sign = (async (ctx: { explorerSegments: () => readonly string[] }) =>
      locFor(ctx.explorerSegments())) as PlacementHistory['sign']
    history.currentLayerAt = async (locSig: string) =>
      locSig === 'loc:page' ? { name: 'page', children: [SIG_B] } : null
    expect(await captureCollectionSig(history, ['page', 'payload'])).toBe(SIG_B)
  })

  it('returns null cleanly when nothing can name the subtree', async () => {
    const history = historyWith({})
    history.sealSubtree = async () => null
    expect(await captureCollectionSig(history, ['page', 'payload'])).toBeNull()
  })
})
