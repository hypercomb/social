// swarm-adopt-additive.spec.ts — adopt on a HELD tile is ADDITIVE.
//
// The rule this file guards: adopting a tile you already hold, that a peer
// has diverged on, must ADD the complete shared subtree while preserving
// every participant-owned layer it meets. It must never replace a held
// layer with the publisher's version, because that would drop local-only
// children and visuals.
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
const SAUCE = '7'.repeat(64)
const LOCAL_PROPS = '6'.repeat(64)
const PEER_PROPS = '5'.repeat(64)
const PEER_RECIPES_LOC = 'e'.repeat(64)
const PEER_RECIPES = '9'.repeat(64)   // the PEER's recipes — children [bread, pasta], NO soup

type Layer = { name?: string; children?: string[]; properties?: string[] }

let layers: Map<string, Layer>
let headByLoc: Map<string, Layer>
let broker: { adopt: ReturnType<typeof vi.fn>; noteDomainsForSig: ReturnType<typeof vi.fn>; getKnownDomains: () => string[] }
let committer: { update: ReturnType<typeof vi.fn>; importTree: ReturnType<typeof vi.fn> }
let peerTiles: Record<string, unknown>[]
let peerByLoc: Map<string, Record<string, unknown>[]>
let registeredDrone: unknown

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
  register: (_key: string, value: unknown) => { registeredDrone = value },
  get: (key: string) => iocRegistry()[key],
}

const { SwarmAdoptDrone } = await import('./swarm-adopt.drone.js')
const drone = registeredDrone as InstanceType<typeof SwarmAdoptDrone>

/** I hold `recipes` with children [bread, soup]; a peer publishes recipes
 *  with children [bread, pasta] — so `pasta` is the one thing I lack. */
const heldWithPeerSuperset = () => {
  layers = new Map<string, Layer>([
    [RECIPES, { name: 'recipes', children: [BREAD, SOUP], properties: [LOCAL_PROPS] }],       // mine
    [PEER_RECIPES, { name: 'recipes', children: [BREAD, PASTA], properties: [PEER_PROPS] }], // peer's — distinct, no soup
    [BREAD, { name: 'bread', children: [] }],
    [SOUP, { name: 'soup', children: [] }],
    [PASTA, { name: 'pasta', children: [SAUCE] }],
    [SAUCE, { name: 'sauce', children: [] }],
  ])
  headByLoc = new Map<string, Layer>([['loc:', { name: 'root', children: [RECIPES] }]])
  broker = {
    adopt: vi.fn(async () => ({ layers: 4, leaves: 0, failed: 0 })),
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
      for (const u of updates) headByLoc.set('loc:' + u.segments.join('/'), { ...u.layer })
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

beforeEach(() => { localStorage.clear() })

describe('adopt on a held tile is additive', () => {

  it('folds every missing descendant and preserves my-only content', async () => {
    heldWithPeerSuperset()

    const landed = new Promise<void>(resolve => {
      const off = EffectBus.on('fs:changed', () => { off(); resolve() })
    })
    EffectBus.emit('tile:action', { action: 'adopt', label: 'recipes' })
    await landed

    const segs = importedSegments()
    // The missing child and everything beneath it land in one import.
    expect(segs.some(s => s.join('/') === 'recipes/pasta')).toBe(true)
    expect(segs.some(s => s.join('/') === 'recipes/pasta/sauce')).toBe(true)

    // The held layer keeps both its local-only child and its local visual while
    // gaining the publisher's missing branch.
    const recipesLink = importedUpdates().find(u => u.segments.join('/') === 'recipes')
    expect(recipesLink).toBeTruthy()
    expect(recipesLink!.layer.children).toContain('soup')   // mine-only, PRESERVED
    expect(recipesLink!.layer.children).toContain('pasta')  // peer's, ADDED
    expect(recipesLink!.layer.children).toContain('bread')  // shared, kept
    expect(recipesLink!.layer.properties).toEqual([LOCAL_PROPS])
  })

  it('records the held tile\'s receipt on success so the adopt affordance clears', async () => {
    heldWithPeerSuperset()

    const res = await drone.adoptResolvedBranch(
      { layerSig: PEER_RECIPES, at: [], label: 'recipes' },
      { mode: 'additive' },
    )
    expect(res).toBe('committed')

    const receipts = JSON.parse(localStorage.getItem('hc:synced-publisher-roots') ?? '{}')
    // Keyed by the held tile's path, valued at the peer's announced generation.
    expect(receipts['recipes']).toBe(PEER_RECIPES)
  })

  it('a held tile with no missing children keeps its local layer intact', async () => {
    heldWithPeerSuperset()
    // The signed peer branch contains only a child I already hold.
    layers.set(PEER_RECIPES, { name: 'recipes', children: [BREAD], properties: [PEER_PROPS] })

    const res = await drone.adoptResolvedBranch(
      { layerSig: PEER_RECIPES, at: [], label: 'recipes' },
      { mode: 'additive' },
    )
    expect(res).toBe('committed')

    const recipesLink = importedUpdates().find(u => u.segments.join('/') === 'recipes')
    expect(recipesLink?.layer.children).toEqual(expect.arrayContaining(['bread', 'soup']))
    expect(recipesLink?.layer.properties).toEqual([LOCAL_PROPS])
  })

})
