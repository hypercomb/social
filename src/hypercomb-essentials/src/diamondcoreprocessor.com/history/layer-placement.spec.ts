// layer-placement.spec.ts — the strict/non-strict children reads that
// membership SETs (paste, cut, move, promote, copy, /layout apply) depend
// on. The contract under test: childNamesOf drops unresolvable sigs
// SILENTLY (read-only render paths only); childNamesOfStrict reports the
// cold miss so writers can refuse instead of wiping the sibling.

import { describe, expect, it } from 'vitest'
import { childNamesOf, childNamesOfStrict, flattenLayerTree, resolvePasteSource, type PlacementHistory, type PlacementLayer } from './layer-placement.js'

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
// resolvePasteSource — sig first, parent-chain fallback, own-bag only
// in-place. Pins the cut+paste-elsewhere fix: after a cut the source
// parent's head no longer lists the child, so ONLY the intent-captured
// sig can resolve it at a different destination.
// -------------------------------------------------

const SRC_LOC = 'd'.repeat(64)
const DST_LOC = 'e'.repeat(64)

/** History fixture with path-addressed heads and sig-addressed layers.
 *  sign() derives a deterministic pseudo-loc-sig from the segments so
 *  resolveLayerAt's parent-chain walk works against `heads`. */
const worldWith = (opts: {
  layersBySig?: Record<string, PlacementLayer | null>
  headsByPath?: Record<string, PlacementLayer | null>
}): PlacementHistory => {
  const locFor = (segs: readonly string[]) => 'loc:' + segs.join('/')
  return {
    sign: async (ctx: { explorerSegments: () => readonly string[] }) => locFor(ctx.explorerSegments()),
    currentLayerAt: async (locSig: string) => {
      if (locSig.startsWith('loc:')) return opts.headsByPath?.[locSig.slice(4)] ?? null
      return opts.headsByPath?.[locSig] ?? null
    },
    commitLayer: async () => 'x'.repeat(64),
    getLayerBySig: async (sig: string) => opts.layersBySig?.[sig] ?? null,
  } as unknown as PlacementHistory
}

describe('resolvePasteSource', () => {
  it('resolves by intent-captured sig even when the parent no longer lists the child (cut+paste-elsewhere)', async () => {
    const history = worldWith({
      layersBySig: { [SIG_A]: { name: 'payload', children: [] } },
      headsByPath: { 'page': { name: 'page', children: [] } },  // post-cut: child GONE from head
    })
    const layer = await resolvePasteSource(history, undefined,
      { label: 'payload', sourceSegments: ['page'], sig: SIG_A }, SRC_LOC, DST_LOC)
    expect(layer?.name).toBe('payload')
  })

  it('falls back to the source parent chain when the sig is absent (legacy entry, source in place)', async () => {
    const history = worldWith({
      layersBySig: { [SIG_B]: { name: 'payload', children: [] } },
      headsByPath: { 'page': { name: 'page', children: [SIG_B] } },
    })
    const layer = await resolvePasteSource(history, undefined,
      { label: 'payload', sourceSegments: ['page'] }, SRC_LOC, DST_LOC)
    expect(layer?.name).toBe('payload')
  })

  it('falls back to the parent chain when the sig no longer resolves', async () => {
    const history = worldWith({
      layersBySig: { [SIG_B]: { name: 'payload', children: [] } },
      headsByPath: { 'page': { name: 'page', children: [SIG_B] } },
    })
    const layer = await resolvePasteSource(history, undefined,
      { label: 'payload', sourceSegments: ['page'], sig: SIG_C }, SRC_LOC, DST_LOC)
    expect(layer?.name).toBe('payload')
  })

  it('uses the own-bag read ONLY for cut-in-place (src === dst)', async () => {
    const history = worldWith({
      headsByPath: { [SRC_LOC]: { name: 'payload', children: [] } },  // own bag persists post-cut
    })
    const entry = { label: 'payload', sourceSegments: ['page'] }
    const inPlace = await resolvePasteSource(history, undefined, entry, SRC_LOC, SRC_LOC)
    expect(inPlace?.name).toBe('payload')
    const elsewhere = await resolvePasteSource(history, undefined, entry, SRC_LOC, DST_LOC)
    expect(elsewhere).toBeNull()  // never dump an own-bag seed at a foreign destination
  })

  it('returns null cleanly when nothing resolves', async () => {
    const history = worldWith({})
    const layer = await resolvePasteSource(history, undefined,
      { label: 'payload', sourceSegments: ['page'], sig: SIG_A }, SRC_LOC, DST_LOC)
    expect(layer).toBeNull()
  })
})
