// swarm-adopt-additive.spec.ts — adopt on a HELD tile is ADDITIVE.
//
// The rule this file guards: adopting a tile you already hold, that a peer
// has diverged on, must ADD the children they publish that you lack and
// touch NOTHING else. It must never re-home (overwrite) the tile — that
// path SETs the tile's children to the peer's list and so drops any child
// you have that they lack. The structural proof: the held tile is never a
// fold target; only the missing child's location is imported.
//
// Real machinery runs (resolveCurrentLayer, childLayerOf, childNamesOfStrict,
// flattenLayerTree, the drone's own routing); only IoC leaves — history,
// broker, committer, swarm cache — are stubbed. window.ioc is set BEFORE the
// import because the drone self-registers at load.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const P1 = '1'.repeat(64)        // publisher pubkey — folds verify the 64-hex shape
const RECIPES = 'a'.repeat(64)        // MY recipes — children [bread, soup]
const BREAD = 'b'.repeat(64)
const SOUP = 'c'.repeat(64)
const PASTA = 'd'.repeat(64)
const PEER_RECIPES_LOC = 'e'.repeat(64)
const PEER_RECIPES = '9'.repeat(64)   // the PEER's recipes — children [bread, pasta], NO soup

type Layer = { name?: string; children?: string[] }

let layers: Map<string, Layer>
let headByLoc: Map<string, Layer>
let broker: { adopt: ReturnType<typeof vi.fn>; noteDomainsForSig: ReturnType<typeof vi.fn>; getKnownDomains: () => string[] }
let committer: { update: ReturnType<typeof vi.fn>; importTree: ReturnType<typeof vi.fn> }
let peerTiles: Record<string, unknown>[]
let peerByLoc: Map<string, Record<string, unknown>[]>

const history = {
  sign: vi.fn(async (l: { explorerSegments: () => readonly string[] }) => 'loc:' + l.explorerSegments().join('/')),
  currentLayerAt: vi.fn(async (loc: string) => headByLoc.get(loc) ?? null),
  latestMarkerSigFor: vi.fn(async () => ''),
  getLayerBySig: vi.fn(async (sig: string) => layers.get(String(sig).toLowerCase()) ?? null),
  commitLayer: vi.fn(async () => 'f'.repeat(64)),
}

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': {
    peerTilesAtCurrentSig: () => peerTiles,
    subscribedTiles: () => [],
    peerTilesAtSig: (sig: string) => peerByLoc.get(sig) ?? [],
    composeSigForSegments: async (segs: readonly string[]) =>
      segs.join('/') === 'recipes' ? PEER_RECIPES_LOC : '',
  },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/LayerCommitter': committer,
  '@diamondcoreprocessor.com/HistoryCursorService': { state: { rewound: false } },
})

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => iocRegistry()[key],
}

await import('./swarm-adopt.drone.js')

/** I hold `recipes` with children [bread, soup]; a peer publishes recipes
 *  with children [bread, pasta] — so `pasta` is the one thing I lack. */
const heldWithPeerSuperset = () => {
  layers = new Map<string, Layer>([
    [RECIPES, { name: 'recipes', children: [BREAD, SOUP] }],       // mine
    [PEER_RECIPES, { name: 'recipes', children: [BREAD, PASTA] }], // peer's — distinct, no soup
    [BREAD, { name: 'bread', children: [] }],
    [SOUP, { name: 'soup', children: [] }],
    [PASTA, { name: 'pasta', children: [] }],
  ])
  headByLoc = new Map<string, Layer>([['loc:', { name: 'root', children: [RECIPES] }]])
  broker = {
    adopt: vi.fn(async () => ({ layers: 1, leaves: 0, failed: 0 })),
    noteDomainsForSig: vi.fn(),
    getKnownDomains: () => [],
  }
  // importTree LANDS like the real committer: the fold target gets a marker
  // in its own bag AND its sig is linked into the parent's live children —
  // the read-back resolves through either the location bag or the
  // parent-chain path, so both must reflect the commit.
  committer = {
    update: vi.fn(async () => 'f'.repeat(64)),
    importTree: vi.fn(async (updates: { segments: string[]; layer: Layer }[]) => {
      for (const u of updates) {
        const loc = 'loc:' + u.segments.join('/')
        if (u.segments.join('/') === 'recipes/pasta') {
          headByLoc.set(loc, { name: 'pasta', children: [] })
          const rec = layers.get(RECIPES)!
          rec.children = [...(rec.children ?? []), PASTA]
          headByLoc.set('loc:recipes', { name: 'recipes', children: [...rec.children] })
        } else {
          headByLoc.set(loc, { name: u.layer.name ?? u.segments[u.segments.length - 1] ?? 'root', children: [] })
        }
      }
    }),
  }
  peerTiles = [{ name: 'recipes', peerPubkey: P1, layerSig: PEER_RECIPES }]
  peerByLoc = new Map<string, Record<string, unknown>[]>([
    [PEER_RECIPES_LOC, [
      { name: 'bread', peerPubkey: P1, layerSig: BREAD },
      { name: 'pasta', peerPubkey: P1, layerSig: PASTA },
    ]],
  ])
}

/** Every {segments, layer} update passed to importTree across this run. */
const importedUpdates = (): { segments: string[]; layer: Layer }[] =>
  committer.importTree.mock.calls.flatMap((c: unknown[]) => c[0] as { segments: string[]; layer: Layer }[])

/** Segments passed to importTree across every call this run. */
const importedSegments = (): string[][] => importedUpdates().map(u => u.segments)

const settle = async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); await Promise.resolve() }

beforeEach(() => { localStorage.clear() })

describe('adopt on a held tile is additive', () => {

  it('folds the missing child and keeps my-only child — the parent link is additive', async () => {
    heldWithPeerSuperset()

    EffectBus.emit('tile:action', { action: 'adopt', label: 'recipes' })
    await settle()

    const segs = importedSegments()
    // The missing child was folded at its own location…
    expect(segs.some(s => s.join('/') === 'recipes/pasta')).toBe(true)
    // `bread` (held on both sides) is never re-folded — additive means new-only.
    expect(segs.some(s => s.join('/') === 'recipes/bread')).toBe(false)

    // THE additive guarantee. The held tile's children list is rebuilt from MY
    // existing children + the new name — NOT SET to the peer's [bread, pasta].
    // So `soup` (mine-only) survives; the destructive re-home would drop it.
    const recipesLink = importedUpdates().find(u => u.segments.join('/') === 'recipes')
    expect(recipesLink).toBeTruthy()
    expect(recipesLink!.layer.children).toContain('soup')   // mine-only, PRESERVED
    expect(recipesLink!.layer.children).toContain('pasta')  // peer's, ADDED
    expect(recipesLink!.layer.children).toContain('bread')  // shared, kept
  })

  it('records the held tile\'s receipt on success so the adopt affordance clears', async () => {
    heldWithPeerSuperset()

    EffectBus.emit('tile:action', { action: 'adopt', label: 'recipes' })
    await settle()

    const receipts = JSON.parse(localStorage.getItem('hc:synced-publisher-roots') ?? '{}')
    // Keyed by the held tile's path, valued at the peer's announced generation.
    expect(receipts['recipes']).toBe(PEER_RECIPES)
  })

  it('a held tile with nothing new imports nothing', async () => {
    heldWithPeerSuperset()
    // Peer offers only what I already hold → no missing child.
    peerByLoc.set(PEER_RECIPES_LOC, [{ name: 'bread', peerPubkey: P1, layerSig: BREAD }])

    EffectBus.emit('tile:action', { action: 'adopt', label: 'recipes' })
    await settle()

    expect(committer.importTree).not.toHaveBeenCalled()
  })

})
