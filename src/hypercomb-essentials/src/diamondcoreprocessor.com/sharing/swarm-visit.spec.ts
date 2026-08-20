// swarm-visit.spec.ts — THE WALK IS A LOOK, THE WAND IS THE KEEP.
//
// Jaime's ruling (2026-08-20) replaced visit-driven acquisition: walking
// into somebody's tile no longer makes it yours. Taking is one deliberate
// gesture — ctrl (⌘) + press over a witnessed tile — and it takes THAT
// ITEM, never its children.
//
// The rules this file guards:
//   1. A WALK KEEPS NOTHING: entering a peer-offered tile commits nothing
//      and mints no record (no genome, no receipt, no adopted root).
//   2. THE WAND takes that ONE tile with the publisher's real props from
//      the wire — never a husk, never the subtree, never the swarm
//      metadata (layerSig/inviteSig/peerPubkey stay out). `index` DOES
//      travel (Jaime, 2026-08-20): the tile was rendered at that slot as
//      a witness, and taking it must not move it — it loses its
//      transparency and shows static, exactly where it stood. A landed
//      take mints the records: visit genome, sync receipt, adopted root.
//   3. The wand is EXPLICIT, so it CLEARS a tombstone — the way back in
//      after a delete. (A walk, keeping nothing, can't resurrect one.)
//   4. Outside a zone, or over a tile nobody offers here, the wand does
//      nothing at all.
//   5. LANDED-OR-NOTHING: a take the committer refused mints no records.
//   6. A rewound history cursor refuses the take up front.
//   7. Walking into a tile you ALREADY took REFRESHES its provenance;
//      walking into a held tile you never took mints no record (the
//      genome means "I took this", and the collection rim reads it).
//
// Real machinery runs (writeTilePropertiesAt's read-merge-commit,
// resolveCurrentLayer, childLayerOf); only IoC leaves — history, store,
// committer, broker, swarm — are stubbed. window.ioc is set BEFORE the
// import because the drone self-registers at load. OWN FILE: EffectBus
// last-value replay leaks across specs sharing a module registry.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { visitRecordAt, recordVisit, _resetVisitGenomeCache } from './visit-genome.js'
import { markAdoptTombstone, isAdoptTombstoned } from './adopted-roots.js'

const GARDEN = 'a'.repeat(64)        // local layer sig once taken
const PEER_GARDEN = '9'.repeat(64)   // the publisher's sealed branch handle
const IMG = '3'.repeat(64)
const PROPS_SIG = 'f'.repeat(64)
const PK = '1'.repeat(64)

type Layer = { name?: string; children?: string[]; properties?: string[] }

let layers: Map<string, Layer>
let headByLoc: Map<string, Layer>
let putBodies: string[]
let store: { getResource: ReturnType<typeof vi.fn>; putResource: ReturnType<typeof vi.fn> }
let committer: { commitSlotSet: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; importTree: ReturnType<typeof vi.fn> }
let broker: { adopt: ReturnType<typeof vi.fn>; getKnownDomains: ReturnType<typeof vi.fn> }
let cursor: { state: { rewound: boolean }; currentLayerSig?: string }
let commitLands: boolean
/** What the zone offers HERE — what the wand can reach. */
let peerTiles: Record<string, unknown>[]

const history = {
  sign: vi.fn(async (l: { explorerSegments?: () => readonly string[] }) => 'loc:' + (l.explorerSegments?.() ?? []).join('/')),
  currentLayerAt: vi.fn(async (loc: string) => headByLoc.get(loc) ?? null),
  latestMarkerSigFor: vi.fn(async () => ''),
  getLayerBySig: vi.fn(async (sig: string) => layers.get(String(sig).toLowerCase()) ?? null),
  commitLayer: vi.fn(async () => 'e'.repeat(64)),
}

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': {
    peerTilesAtCurrentSig: () => peerTiles,
    subscribedTiles: () => peerTiles,
    peerTilesAtSig: () => [],
    withheldByPeer: () => ['visual:website:page'],
  },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@hypercomb.social/Store': store,
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/LayerCommitter': committer,
  '@diamondcoreprocessor.com/HistoryCursorService': cursor,
})

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => iocRegistry()[key],
}

await import('./swarm-adopt.drone.js')

const GARDEN_OFFER = {
  name: 'garden',
  peerPubkey: PK,
  layerSig: PEER_GARDEN,
  imageSig: IMG,
  tags: ['flowers'],
  hideText: true,
  index: 4,            // the rendered slot — MUST travel (the tile never jumps)
  inviteSig: '2'.repeat(64),
}

/** Fresh world: I hold an EMPTY root; a peer offers `garden` there. */
const freshWorld = () => {
  layers = new Map<string, Layer>([[GARDEN, { name: 'garden', children: [] }]])
  headByLoc = new Map<string, Layer>([['loc:', { name: 'root', children: [] }]])
  putBodies = []
  peerTiles = [{ ...GARDEN_OFFER }]
  // The REAL cursor service exposes a position sig even at head — only
  // state.rewound means "viewing the past". Gating a take on the mere
  // presence of currentLayerSig killed every fold in the live shell;
  // this stub pins the honest shape so that regression stays caught.
  cursor = { state: { rewound: false }, currentLayerSig: 'c'.repeat(64) }
  commitLands = true
  store = {
    getResource: vi.fn(async () => null),
    // This DOM environment has no Blob.prototype.text — read via FileReader.
    putResource: vi.fn(async (blob: Blob) => {
      putBodies.push(await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result ?? ''))
        r.onerror = () => reject(r.error)
        r.readAsText(blob)
      }))
      return PROPS_SIG
    }),
  }
  committer = {
    update: vi.fn(async () => 'e'.repeat(64)),
    // The REAL contract: importTree is what MATERIALIZES a new child (parent
    // link + child layer — the egg shape); commitSlotSet only edits slots on
    // an EXISTING tile. The stub mirrors a landed importTree, and does
    // nothing when refused (preview active / transient) — the read-back then
    // honestly reports nothing landed. Modelling creation on commitSlotSet
    // was exactly the drift that let a silently-dead live fold pass specs.
    importTree: vi.fn(async (updates: { segments: readonly string[]; layer: Layer }[]) => {
      if (!commitLands) return
      for (const u of updates) {
        if (u.segments.join('/') === 'garden') {
          headByLoc.set('loc:garden', { name: 'garden', children: [] })
          headByLoc.set('loc:', { name: 'root', children: [GARDEN] })
        }
      }
    }),
    commitSlotSet: vi.fn(async (segments: readonly string[], _slot: string, sigs: readonly string[]) => {
      const loc = 'loc:' + segments.join('/')
      const layer = headByLoc.get(loc)
      if (layer) layer.properties = [...sigs]
    }),
  }
  broker = {
    adopt: vi.fn(async () => ({ layers: 1, leaves: 0, failed: 0 })),
    getKnownDomains: vi.fn(() => ['bees.example']),
  }
}

/** Walk into the peer's tile — the signal SwarmDrone emits per navigation. */
const visitGarden = () => {
  EffectBus.emit('swarm:tile-visited', {
    segments: ['garden'],
    parentSegments: [],
    name: 'garden',
    entry: { ...GARDEN_OFFER },
  })
}

/** Ctrl+press over the witnessed tile — what SelectionInputDrone emits. */
const wandGarden = () => { EffectBus.emitTransient('swarm:wand', { label: 'garden' }) }

/** Standing in a zone is the wand's first condition. */
const inZone = () => { localStorage.setItem('hc:mesh-public', 'true') }

const settle = async () => {
  for (let i = 0; i < 4; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)) }
}

beforeEach(() => {
  localStorage.clear()
  _resetVisitGenomeCache()
})

describe('the walk is a look', () => {

  it('entering a peer-offered tile keeps NOTHING — no commit, no records', async () => {
    freshWorld()
    inZone()

    visitGarden()
    await settle()

    expect(committer.importTree).not.toHaveBeenCalled()
    expect(committer.commitSlotSet).not.toHaveBeenCalled()
    expect(store.putResource).not.toHaveBeenCalled()
    expect(visitRecordAt(['garden'])).toBeNull()
    expect(localStorage.getItem('hc:synced-publisher-roots')).toBeNull()
    expect(localStorage.getItem('hc:adopted-roots')).toBeNull()
  })

  it('re-entering a tile you TOOK refreshes its provenance', async () => {
    freshWorld()
    inZone()
    headByLoc.set('loc:', { name: 'root', children: [GARDEN] })   // garden is mine
    recordVisit({ segments: ['garden'], layerSig: '4'.repeat(64), pubkey: PK })

    visitGarden()
    await settle()

    expect(committer.importTree).not.toHaveBeenCalled()
    // The publisher's CURRENT handle is now the baseline.
    expect(visitRecordAt(['garden'])!.layerSig).toBe(PEER_GARDEN)
  })

  it('a held tile you never took stays recordless — the rim is not green for a walk', async () => {
    freshWorld()
    inZone()
    headByLoc.set('loc:', { name: 'root', children: [GARDEN] })   // mine, but authored here

    visitGarden()
    await settle()

    expect(visitRecordAt(['garden'])).toBeNull()
  })

})

describe('the wand is the keep', () => {

  it('takes THAT ONE tile with the publisher\'s props — never a husk, never swarm metadata', async () => {
    freshWorld()
    inZone()

    wandGarden()
    await settle()

    // The take MATERIALIZED the tile — parent link + child layer via
    // importTree (the egg shape) — with its properties in the SAME commit.
    expect(committer.importTree).toHaveBeenCalled()
    const updates = committer.importTree.mock.calls[0][0] as { segments: string[]; layer: Layer }[]
    const child = updates.find(u => u.segments.join('/') === 'garden')
    expect(child?.layer.name).toBe('garden')
    // THE ITEM, NOT ITS CHILDREN: what is inside stays the publisher's
    // until the participant walks in and wands it there too.
    expect(child?.layer.children).toEqual([])
    const rootUpdate = updates.find(u => u.segments.length === 0)
    expect(rootUpdate?.layer.children).toContain('garden')
    expect(child?.layer.properties).toEqual([PROPS_SIG])
    expect(committer.commitSlotSet).not.toHaveBeenCalled()

    // Real props travelled: image + tags + hideText from the wire visual.
    const body = JSON.parse(putBodies[putBodies.length - 1]) as Record<string, unknown>
    expect(body['imageSig']).toBe(IMG)
    expect(body['tags']).toEqual(['flowers'])
    expect(body['hideText']).toBe(true)
    // Swarm metadata stays OUT of the taken 0000.
    // THE SLOT TRAVELS: the tile was rendered at the publisher's slot as
    // a witness; the take keeps it there — no score-fill jump on landing.
    expect(body['index']).toBe(4)
    expect(body['layerSig']).toBeUndefined()
    expect(body['inviteSig']).toBeUndefined()
    expect(body['peerPubkey']).toBeUndefined()

    // Records of a LANDED take: genome, receipt, adopted root.
    const rec = visitRecordAt(['garden'])
    expect(rec).toBeTruthy()
    expect(rec!.layerSig).toBe(PEER_GARDEN)
    expect(rec!.pubkey).toBe(PK)
    const receipts = JSON.parse(localStorage.getItem('hc:synced-publisher-roots') ?? '{}')
    expect(receipts['garden']).toBe(PEER_GARDEN)
    const roots = JSON.parse(localStorage.getItem('hc:adopted-roots') ?? '[]') as string[][]
    expect(roots.some(r => r.join('/') === 'garden')).toBe(true)
    // The publisher's withheld roster landed at the root.
    const withheld = JSON.parse(localStorage.getItem('hc:withheld-at-roots') ?? '{}')
    expect(Object.keys(withheld).length).toBeGreaterThan(0)
  })

  it('CLEARS a tombstone — an explicit gesture is the way back in', async () => {
    freshWorld()
    inZone()
    markAdoptTombstone(['garden'])

    wandGarden()
    await settle()

    expect(committer.importTree).toHaveBeenCalled()
    expect(isAdoptTombstoned(['garden'])).toBe(false)
    expect(visitRecordAt(['garden'])).toBeTruthy()
  })

  it('does nothing outside a zone, and nothing over a name nobody offers here', async () => {
    freshWorld()                       // no zone
    wandGarden()
    await settle()
    expect(committer.importTree).not.toHaveBeenCalled()

    freshWorld()
    inZone()
    peerTiles = []                     // the offer is gone
    wandGarden()
    await settle()
    expect(committer.importTree).not.toHaveBeenCalled()
    expect(visitRecordAt(['garden'])).toBeNull()
  })

  it('LANDED-OR-NOTHING: a refused commit mints no records', async () => {
    freshWorld()
    inZone()
    commitLands = false   // committer refuses (preview active / transient)

    wandGarden()
    await settle()

    // The props blob is content-addressed and inert — a refused commit
    // may leave the bytes, but never a record.
    expect(visitRecordAt(['garden'])).toBeNull()
    expect(localStorage.getItem('hc:synced-publisher-roots')).toBeNull()
    expect(localStorage.getItem('hc:adopted-roots')).toBeNull()
  })

  it('a rewound history cursor refuses the take up front', async () => {
    freshWorld()
    inZone()
    cursor.state.rewound = true   // viewing the past

    wandGarden()
    await settle()

    expect(committer.importTree).not.toHaveBeenCalled()
    expect(store.putResource).not.toHaveBeenCalled()
    expect(visitRecordAt(['garden'])).toBeNull()
  })

})
