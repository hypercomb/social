// swarm-visit.spec.ts — THE WALK IS THE ADOPT (visit-driven acquisition).
//
// The rules this file guards, now that the adopt button is gone:
//   1. Entering a peer-offered tile folds THAT ONE tile with the
//      publisher's real props from the wire — never a husk, never the
//      subtree (children fold only as they are themselves entered), and
//      never the swarm metadata (index/layerSig/inviteSig stay out).
//   2. A landed fold mints the records: visit genome, sync receipt
//      (divergence baselines instead of re-lighting), adopted root at the
//      drill's TOPMOST foreign tile.
//   3. DELETE IS THE UNSUBSCRIBE: a tombstoned path never re-folds on a
//      walk, and the walk never clears the stone.
//   4. A held tile's visit is a no-op — visiting what is already yours
//      writes nothing.
//   5. LANDED-OR-NOTHING: a fold the committer refused mints no records.
//   6. A rewound history cursor refuses the fold up front.
//
// Real machinery runs (writeTilePropertiesAt's read-merge-commit,
// resolveCurrentLayer, childLayerOf); only IoC leaves — history, store,
// committer, broker, swarm — are stubbed. window.ioc is set BEFORE the
// import because the drone self-registers at load. OWN FILE: EffectBus
// last-value replay leaks across specs sharing a module registry.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { visitRecordAt, _resetVisitGenomeCache } from './visit-genome.js'
import { markAdoptTombstone, isAdoptTombstoned } from './adopted-roots.js'

const GARDEN = 'a'.repeat(64)        // local layer sig once folded
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

const history = {
  sign: vi.fn(async (l: { explorerSegments?: () => readonly string[] }) => 'loc:' + (l.explorerSegments?.() ?? []).join('/')),
  currentLayerAt: vi.fn(async (loc: string) => headByLoc.get(loc) ?? null),
  latestMarkerSigFor: vi.fn(async () => ''),
  getLayerBySig: vi.fn(async (sig: string) => layers.get(String(sig).toLowerCase()) ?? null),
  commitLayer: vi.fn(async () => 'e'.repeat(64)),
}

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': {
    peerTilesAtCurrentSig: () => [],
    subscribedTiles: () => [],
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

/** Fresh world: I hold an EMPTY root; a peer offers `garden` there. */
const freshWorld = () => {
  layers = new Map<string, Layer>([[GARDEN, { name: 'garden', children: [] }]])
  headByLoc = new Map<string, Layer>([['loc:', { name: 'root', children: [] }]])
  putBodies = []
  // The REAL cursor service exposes a position sig even at head — only
  // state.rewound means "viewing the past". Gating a fold on the mere
  // presence of currentLayerSig killed every visit fold in the live shell;
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

const visitGarden = () => {
  EffectBus.emit('swarm:tile-visited', {
    segments: ['garden'],
    parentSegments: [],
    name: 'garden',
    entry: {
      name: 'garden',
      peerPubkey: PK,
      layerSig: PEER_GARDEN,
      imageSig: IMG,
      tags: ['flowers'],
      hideText: true,
      index: 4,            // swarm metadata — must NOT fold
      inviteSig: '2'.repeat(64),
    },
  })
}

const settle = async () => {
  for (let i = 0; i < 4; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)) }
}

beforeEach(() => {
  localStorage.clear()
  _resetVisitGenomeCache()
})

describe('the walk is the adopt', () => {

  it('entering a peer-offered tile folds it with the publisher\'s props — never a husk, never swarm metadata', async () => {
    freshWorld()
    visitGarden()
    await settle()

    // The fold MATERIALIZED the tile — parent link + child layer via
    // importTree (the egg shape) — then wrote its properties slot.
    expect(committer.importTree).toHaveBeenCalled()
    const updates = committer.importTree.mock.calls[0][0] as { segments: string[]; layer: Layer }[]
    expect(updates.some(u => u.segments.join('/') === 'garden' && u.layer.name === 'garden')).toBe(true)
    const rootUpdate = updates.find(u => u.segments.length === 0)
    expect(rootUpdate?.layer.children).toContain('garden')
    expect(committer.commitSlotSet).toHaveBeenCalled()
    const [segs, slot] = committer.commitSlotSet.mock.calls[0] as [string[], string, string[]]
    expect(segs.join('/')).toBe('garden')
    expect(slot).toBe('properties')

    // Real props travelled: image + tags + hideText from the wire visual.
    const body = JSON.parse(putBodies[putBodies.length - 1]) as Record<string, unknown>
    expect(body['imageSig']).toBe(IMG)
    expect(body['tags']).toEqual(['flowers'])
    expect(body['hideText']).toBe(true)
    // Swarm metadata stays OUT of the folded 0000.
    expect(body['index']).toBeUndefined()
    expect(body['layerSig']).toBeUndefined()
    expect(body['inviteSig']).toBeUndefined()
    expect(body['peerPubkey']).toBeUndefined()

    // Records of a LANDED fold: genome, receipt, adopted root.
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

  it('a tombstoned path never re-folds on a walk, and the walk never clears the stone', async () => {
    freshWorld()
    markAdoptTombstone(['garden'])

    visitGarden()
    await settle()

    expect(committer.importTree).not.toHaveBeenCalled()
    expect(committer.commitSlotSet).not.toHaveBeenCalled()
    expect(visitRecordAt(['garden'])).toBeNull()
    expect(isAdoptTombstoned(['garden'])).toBe(true)   // still stoned
  })

  it('a held tile\'s visit writes nothing — visiting what is yours is free', async () => {
    freshWorld()
    headByLoc.set('loc:', { name: 'root', children: [GARDEN] })  // garden already mine

    visitGarden()
    await settle()

    expect(committer.importTree).not.toHaveBeenCalled()
    expect(committer.commitSlotSet).not.toHaveBeenCalled()
    expect(store.putResource).not.toHaveBeenCalled()
  })

  it('LANDED-OR-NOTHING: a refused commit mints no records', async () => {
    freshWorld()
    commitLands = false   // committer refuses (preview active / transient)

    visitGarden()
    await settle()

    // Props are written only AFTER the read-back proves the tile landed —
    // a refused materialization leaves no bytes, no slot write, no records.
    expect(store.putResource).not.toHaveBeenCalled()
    expect(committer.commitSlotSet).not.toHaveBeenCalled()
    expect(visitRecordAt(['garden'])).toBeNull()
    expect(localStorage.getItem('hc:synced-publisher-roots')).toBeNull()
    expect(localStorage.getItem('hc:adopted-roots')).toBeNull()
  })

  it('a rewound history cursor refuses the fold up front', async () => {
    freshWorld()
    cursor.state.rewound = true   // viewing the past

    visitGarden()
    await settle()

    expect(committer.importTree).not.toHaveBeenCalled()
    expect(committer.commitSlotSet).not.toHaveBeenCalled()
    expect(store.putResource).not.toHaveBeenCalled()
    expect(visitRecordAt(['garden'])).toBeNull()
  })

})
