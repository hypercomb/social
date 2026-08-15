// peer-divergence.spec.ts — detection NEVER applies, and never lies.
//
// The guarantee this file exists to protect: joining a swarm where a peer
// changed something must not move a single byte of your hive. The old
// behaviour auto-folded a publisher's newer bytes into any adopted root;
// that is retired, and the only thing left is a set of labels the overlay
// reads to show `adopt` on a tile you already hold.
//
// The second half is about honesty. A detector that over-reports is worse
// than none — a permanently-lit adopt button that resolves nothing trains
// people to ignore it. So the false-positive guards (cold reads, revoked
// paths, peers offering nothing new) are pinned as hard as the detection.
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers
// at load). Own spec file: constructing the drone subscribes it to
// tile:action for the process, so it must not share with the fold specs.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { peerDivergesAt } from './peer-divergence.js'

const ADOPTED_ROOTS_KEY = 'hc:adopted-roots'
const RECEIPTS_KEY = 'hc:synced-publisher-roots'
const TOMBSTONE_KEY = 'hc:adopt-tombstones'

const SIG_OLD = 'a'.repeat(64)
const SIG_NEW = 'b'.repeat(64)
const CHILD_SIG = 'c'.repeat(64)
const PEER_LOC_SIG = 'd'.repeat(64)

type Layer = { name?: string; children?: string[] }

let layersBySig: Map<string, Layer>
let headByLoc: Map<string, Layer>
let committer: { update: ReturnType<typeof vi.fn>; importTree: ReturnType<typeof vi.fn> }
let peerTiles: Record<string, unknown>[]
/** What peers publish INSIDE a tile, keyed by the composed child-location sig. */
let peerTilesByLoc: Map<string, Record<string, unknown>[]>
/** Sigs the scan asked the mesh to prime (probe calls). */
let primedSigs: string[]
/** What the mesh WOULD answer for a primed sig — moved into the live cache
 *  when primePeerTilesAt is called, mimicking the recovery injection. */
let primeable: Map<string, Record<string, unknown>[]>

const history = {
  sign: vi.fn(async (l: { explorerSegments: () => readonly string[] }) => 'loc:' + l.explorerSegments().join('/')),
  currentLayerAt: vi.fn(async (loc: string) => headByLoc.get(loc) ?? null),
  getLayerBySig: vi.fn(async (sig: string) => layersBySig.get(sig) ?? null),
  commitLayer: vi.fn(async () => 'e'.repeat(64)),
}

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': {
    peerTilesAtCurrentSig: () => peerTiles,
    subscribedTiles: () => [],
    peerTilesAtSig: (sig: string) => peerTilesByLoc.get(sig) ?? [],
    composeSigForSegments: async () => PEER_LOC_SIG,
    primePeerTilesAt: async (sig: string) => {
      primedSigs.push(sig)
      const pending = primeable.get(sig)
      if (pending) peerTilesByLoc.set(sig, pending)
    },
  },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@diamondcoreprocessor.com/ContentBrokerDrone': {
    adopt: vi.fn(async () => ({ layers: 1, leaves: 0, failed: 0 })),
    noteDomainsForSig: vi.fn(),
    getKnownDomains: () => [],
  },
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/LayerCommitter': committer,
  '@diamondcoreprocessor.com/HistoryCursorService': { state: { rewound: false } },
})

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => iocRegistry()[key],
}

await import('./swarm-adopt.drone.js')

/**
 * One held tile `label` at the root, which a peer also publishes.
 * `myKids` / `theirKids` are the child NAMES on each side.
 */
const world = (
  label: string,
  opts: { myKids?: string[]; theirKids?: string[]; peerSig?: string; coldKid?: boolean } = {},
) => {
  layersBySig = new Map()
  headByLoc = new Map()
  peerTilesByLoc = new Map()
  primedSigs = []
  primeable = new Map()
  committer = { update: vi.fn(async () => 'f'.repeat(64)), importTree: vi.fn(async () => void 0) }

  const myKids = opts.myKids ?? []
  const kidSigs = myKids.map((k, i) => CHILD_SIG.slice(0, 63) + String(i))
  myKids.forEach((k, i) => layersBySig.set(kidSigs[i], { name: k, children: [] }))
  // A cold kid is a child sig present in the parent whose bytes don't
  // resolve — childNamesOfStrict reports coldMiss and we must stay silent.
  if (opts.coldKid) kidSigs.push('9'.repeat(64))

  layersBySig.set(CHILD_SIG, { name: label, children: kidSigs })
  headByLoc.set('loc:', { name: 'root', children: [CHILD_SIG] })

  peerTiles = [{ name: label, peerPubkey: 'pk1', layerSig: opts.peerSig ?? SIG_NEW }]
  peerTilesByLoc.set(PEER_LOC_SIG, (opts.theirKids ?? []).map(n => ({ name: n, peerPubkey: 'pk1' })))
}

/** Fire the peers-changed burst and let the debounced scan run to completion. */
const runScan = async () => {
  vi.useFakeTimers()
  EffectBus.emit('swarm:peers-changed', {})
  await vi.advanceTimersByTimeAsync(4_100)
  vi.useRealTimers()
  // The scan awaits OPFS-ish reads between timer ticks; give the
  // microtask queue a turn so its last await settles before we assert.
  await Promise.resolve()
  await new Promise(r => setTimeout(r, 0))
}

/** Mark `label` adopted with a receipt at `sig` — the "I took this from a
 *  publisher at this generation" state rule 1 compares against. Adopted
 *  roots and tombstones store SEGMENT ARRAYS (string[][]); receipts key on
 *  the joined path. */
const adoptedAt = (label: string, sig: string) => {
  localStorage.setItem(ADOPTED_ROOTS_KEY, JSON.stringify([[label]]))
  localStorage.setItem(RECEIPTS_KEY, JSON.stringify({ [label]: sig }))
}

beforeEach(() => {
  localStorage.clear()
})

describe('peer divergence — detect, never apply', () => {

  it('a publisher moving past our receipt marks the tile and commits NOTHING', async () => {
    world('dolphin', { peerSig: SIG_NEW })
    adoptedAt('dolphin', SIG_OLD)

    await runScan()

    expect(peerDivergesAt('dolphin')).toBe(true)
    // THE guarantee: nothing was folded, updated, or imported.
    expect(committer.importTree).not.toHaveBeenCalled()
    expect(committer.update).not.toHaveBeenCalled()
  })

  it('a receipt that still matches is silent — nothing to take, nothing shown', async () => {
    world('dolphin', { peerSig: SIG_OLD })
    adoptedAt('dolphin', SIG_OLD)

    await runScan()

    expect(peerDivergesAt('dolphin')).toBe(false)
    expect(committer.importTree).not.toHaveBeenCalled()
  })

  it('children a peer has and we lack mark the tile — the AUTHORED case, no receipt anywhere', async () => {
    world('recipes', { myKids: ['bread'], theirKids: ['bread', 'pasta'] })

    await runScan()

    expect(peerDivergesAt('recipes')).toBe(true)
    expect(committer.importTree).not.toHaveBeenCalled()
  })

  it('children we have that the peer lacks are NOT divergence — adopt is additive', async () => {
    world('recipes', { myKids: ['bread', 'pasta', 'soup'], theirKids: ['bread'] })

    await runScan()

    expect(peerDivergesAt('recipes')).toBe(false)
  })

  it('a cold local read reports nothing — absence of evidence is not divergence', async () => {
    // Their 'pasta' is genuinely unheld, but one of our child sigs won't
    // resolve, so we cannot know. A cold page must not light up wholesale.
    world('recipes', { myKids: ['bread'], theirKids: ['pasta'], coldKid: true })

    await runScan()

    expect(peerDivergesAt('recipes')).toBe(false)
  })

  it('a revoked (tombstoned) path never lights again', async () => {
    world('dolphin', { peerSig: SIG_NEW })
    adoptedAt('dolphin', SIG_OLD)
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify([['dolphin']]))

    await runScan()

    expect(peerDivergesAt('dolphin')).toBe(false)
    expect(committer.importTree).not.toHaveBeenCalled()
  })

  it('a child location never visited is PROBED — blindness is asked about, not settled for', async () => {
    // Their extra child lives on the mesh; the local cache for the child
    // location is cold (the receiver never subscribed there — the exact
    // state that used to make this rule silent forever).
    world('atlas', { myKids: ['bread'], theirKids: [] })
    primeable.set(PEER_LOC_SIG, [{ name: 'pasta', peerPubkey: 'pk1' }])

    await runScan()
    // Cold pass: honest silence (no evidence yet) — but the probe went out.
    expect(peerDivergesAt('atlas')).toBe(false)
    expect(primedSigs).toContain(PEER_LOC_SIG)

    // The injected answer emits peers-changed in production; the next burst
    // re-scans against the now-warm cache and the name diff lights.
    await runScan()
    expect(peerDivergesAt('atlas')).toBe(true)
    expect(committer.importTree).not.toHaveBeenCalled()
    expect(committer.update).not.toHaveBeenCalled()
  })

  it('a publisher changing an AUTHORED held tile lights adopt — the announced-sig watch', async () => {
    // Same children on both sides (no name diff), no adopted root, no
    // receipt — the tile exists independently on both hives. First sight
    // baselines; a CHANGED announced sig afterwards is news.
    world('meadow', { myKids: ['bread'], theirKids: ['bread'] })

    await runScan()
    expect(peerDivergesAt('meadow')).toBe(false)   // joining is not news

    peerTiles = [{ name: 'meadow', peerPubkey: 'pk1', layerSig: SIG_OLD }]
    await runScan()
    expect(peerDivergesAt('meadow')).toBe(true)
    // Detection NEVER applies — still the whole point.
    expect(committer.importTree).not.toHaveBeenCalled()
    expect(committer.update).not.toHaveBeenCalled()
  })

  it('leaving the location drops the answer — it is never carried elsewhere', async () => {
    world('recipes', { myKids: [], theirKids: ['pasta'] })
    await runScan()
    expect(peerDivergesAt('recipes')).toBe(true)

    EffectBus.emit('navigation:guard-start', {})

    expect(peerDivergesAt('recipes')).toBe(false)
  })

})
