// swarm-adopt.spec.ts — the fold's landed-or-owed guarantees.
//
// The scenario that motivated these: a participant joins a swarm, clicks
// adopt on a peer tile, watches the broker import files — and after a
// refresh the tile is nowhere. The live peer projection keeps the screen
// looking right whether or not the fold COMMITTED, so every silent commit
// failure (a rewound cursor's importTree no-op, an incomplete closure's
// deferral dropped by the reload) reads as success until it's too late.
// These specs pin the three guards: refuse-up-front on rewound, read-back
// before reporting 'committed', and a persisted pending-fold that a boot
// resumes.
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers
// at load). History is a tiny in-memory (locKey, sig) store; the committer
// stub decides whether importTree actually "lands" the fold target.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const SIG_PHANTOM = 'a'.repeat(64)
const SIG_REWOUND = 'b'.repeat(64)
const SIG_LANDED = 'c'.repeat(64)
const SIG_RESUME = 'd'.repeat(64)

const PENDING_KEY = 'hc:pending-folds'

const makeHistory = () => {
  const layersBySig = new Map<string, Record<string, unknown>>()
  const headByLoc = new Map<string, Record<string, unknown>>()
  return {
    layersBySig,
    headByLoc,
    sign: vi.fn(async (lineage: { explorerSegments: () => readonly string[] }) =>
      'loc:' + lineage.explorerSegments().join('/')),
    currentLayerAt: vi.fn(async (locSig: string) => headByLoc.get(locSig) ?? null),
    getLayerBySig: vi.fn(async (sig: string) => layersBySig.get(sig) ?? null),
    commitLayer: vi.fn(async () => 'e'.repeat(64)),
  }
}

let history: ReturnType<typeof makeHistory>
let broker: { adopt: ReturnType<typeof vi.fn>; noteDomainsForSig: ReturnType<typeof vi.fn>; getKnownDomains: () => string[] }
let committer: { update: ReturnType<typeof vi.fn>; importTree: ReturnType<typeof vi.fn> }
let cursor: { state: { rewound: boolean } }
let peerTiles: { name: string; peerPubkey: string; layerSig: string }[]

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': {
    peerTilesAtCurrentSig: () => peerTiles,
    subscribedTiles: () => [],
  },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/LayerCommitter': committer,
  '@diamondcoreprocessor.com/HistoryCursorService': cursor,
})

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => iocRegistry()[key],
}

const { SwarmAdoptDrone } = await import('./swarm-adopt.drone.js')

const pendingFolds = (): { sig: string; at: string[] }[] =>
  JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')

/** Configure the world for one branch: a peer offers `label` at the current
 *  (root) location, the branch layer resolves, the local root has no children. */
const offerBranch = (label: string, branchSig: string) => {
  history = makeHistory()
  history.layersBySig.set(branchSig, { name: label, children: [] })
  history.headByLoc.set('loc:', { name: 'root', children: [] })
  broker = {
    adopt: vi.fn(async () => ({ layers: 1, leaves: 0, failed: 0 })),
    noteDomainsForSig: vi.fn(),
    getKnownDomains: () => [],
  }
  committer = { update: vi.fn(async () => 'f'.repeat(64)), importTree: vi.fn(async () => void 0) }
  cursor = { state: { rewound: false } }
  peerTiles = [{ name: label, peerPubkey: 'pk1', layerSig: branchSig }]
}

/** Make importTree actually LAND the fold: a marker appears in the fold
 *  target's own bag, exactly what a real commit produces. */
const landOnImport = (label: string) => {
  committer.importTree = vi.fn(async () => {
    history.headByLoc.set('loc:' + label, { name: label, children: [] })
  })
}

const nextOutcome = (cell: string): Promise<{ ok: boolean; message: string }> =>
  new Promise((resolve) => {
    const off = EffectBus.on<{ cell?: string; ok?: boolean; message?: string }>('features:outcome', (p) => {
      if (p?.cell !== cell) return
      off()
      resolve({ ok: !!p.ok, message: String(p.message ?? '') })
    })
  })

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('swarm-adopt fold — landed-or-owed', () => {

  it('a fold whose importTree writes nothing is deferred, never reported committed', async () => {
    offerBranch('phantom-tile', SIG_PHANTOM)
    // committer.importTree resolves void but lands nothing — the rewound
    // no-op / machine-refusal shape. Pre-fix this surfaced as 'committed'.
    const outcome = nextOutcome('phantom-tile')
    EffectBus.emit('tile:action', { action: 'adopt-selected', selections: [{ label: 'phantom-tile' }] })
    const res = await outcome

    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/isn't reachable/)
    expect(committer.importTree).toHaveBeenCalledTimes(1)
    // The intent survives as a pending fold — a refresh resumes it.
    expect(pendingFolds().map(f => f.sig)).toContain(SIG_PHANTOM)
  })

  it('a rewound cursor refuses up front — honest outcome, no commit attempt, no ladder', async () => {
    offerBranch('rewound-tile', SIG_REWOUND)
    cursor.state.rewound = true

    const outcome = nextOutcome('rewound-tile')
    EffectBus.emit('tile:action', { action: 'adopt-selected', selections: [{ label: 'rewound-tile' }] })
    const res = await outcome

    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/viewing history/)
    expect(committer.importTree).not.toHaveBeenCalled()
    // Only the user can return to head — no retry pretends otherwise.
    expect(pendingFolds()).toHaveLength(0)
  })

  it('a landed fold reports committed and clears the pending intent', async () => {
    offerBranch('landed-tile', SIG_LANDED)
    landOnImport('landed-tile')
    // Simulate an earlier deferral of this same branch.
    localStorage.setItem(PENDING_KEY, JSON.stringify([{ sig: SIG_LANDED, at: [], mode: 'fold' }]))

    const outcome = nextOutcome('landed-tile')
    EffectBus.emit('tile:action', { action: 'adopt-selected', selections: [{ label: 'landed-tile' }] })
    const res = await outcome

    expect(res.ok).toBe(true)
    expect(committer.importTree).toHaveBeenCalledTimes(1)
    expect(pendingFolds()).toHaveLength(0)
  })

  // LAST in the file: constructing a second drone instance leaves it
  // subscribed to tile:action, so no test after this may emit that effect.
  it('a pending fold persisted before a refresh is resumed at boot and completes', async () => {
    offerBranch('resume-tile', SIG_RESUME)
    landOnImport('resume-tile')
    localStorage.setItem(PENDING_KEY, JSON.stringify([{ sig: SIG_RESUME, at: [], mode: 'fold' }]))

    vi.useFakeTimers()
    new SwarmAdoptDrone()   // the boot — constructor re-enters the ladder
    await vi.advanceTimersByTimeAsync(21_000)

    expect(committer.importTree).toHaveBeenCalledTimes(1)
    expect(pendingFolds()).toHaveLength(0)
  })

})
