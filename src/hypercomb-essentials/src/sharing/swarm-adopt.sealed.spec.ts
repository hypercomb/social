// swarm-adopt.sealed.spec.ts — a tile sealed to a key: an egg until the key arrives, then the tile.
//
// The adopt drain is the real one (the real queue, the real drone). What is faked is the world around it: the broker that
// fetches from hosts, the history and committer that hold the hive, and `localizeSealed` — whose own behaviour (real keys,
// the signed index, every atom opened and checked) is pinned in sealed-adopt.spec.ts. Here the question is only what the
// ADOPT does with it: ask when the plain bytes are out of reach, lay an egg when it cannot open, and finish the same adopt
// the moment it can — with the layer closure then found locally, like any adopt.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sealed-adopt.js', () => ({ localizeSealed: vi.fn() }))

const SIG = 'c'.repeat(64)
const PUBLISHER = 'a1'.repeat(32)
const HOST = 'host.example'

const makeHistory = () => {
  const layersBySig = new Map<string, Record<string, unknown>>()
  const headByLoc = new Map<string, Record<string, unknown>>()
  return {
    layersBySig,
    headByLoc,
    sign: vi.fn(async (lineage: { explorerSegments: () => readonly string[] }) => 'loc:' + lineage.explorerSegments().join('/')),
    currentLayerAt: vi.fn(async (locSig: string) => headByLoc.get(locSig) ?? null),
    getLayerBySig: vi.fn(async (sig: string) => layersBySig.get(sig) ?? null),
    commitLayer: vi.fn(async () => 'e'.repeat(64)),
  }
}

let history: ReturnType<typeof makeHistory>
let broker: { adopt: ReturnType<typeof vi.fn>; noteDomainsForSig: ReturnType<typeof vi.fn>; getKnownDomains: (sig: string) => string[] }
let committer: { update: ReturnType<typeof vi.fn>; importTree: ReturnType<typeof vi.fn> }
let cursor: { state: { rewound: boolean } }
let queue: { enqueueAll: (...a: unknown[]) => unknown; entries: readonly { egg?: boolean; label: string }[]; done: readonly { label: string }[]; remaining: number; clear: () => void }

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': { peerTilesAtCurrentSig: () => [], subscribedTiles: () => [] },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/LayerCommitter': committer,
  '@diamondcoreprocessor.com/HistoryCursorService': cursor,
  '@diamondcoreprocessor.com/AdoptQueueService': queue,
})

;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: (key: string) => iocRegistry()[key] }

const { localizeSealed } = await import('./sealed-adopt.js')
const { _adoptQueue } = await import('./adopt-queue.service.js')
const { SwarmAdoptDrone } = await import('./swarm-adopt.drone.js')
queue = _adoptQueue as unknown as typeof queue
const opens = vi.mocked(localizeSealed)

/** The world for one sealed tile: its plain bytes are NOT reachable (the broker fails) until the key opens it. */
const world = (label: string) => {
  history = makeHistory()
  history.headByLoc.set('loc:', { name: 'root', children: [] })
  let keyed = false
  broker = {
    // Before the key: the host answers 404 for the plain root. After: the closure is local, like any adopt.
    adopt: vi.fn(async () => (keyed ? { layers: 1, leaves: 0, failed: 0 } : { layers: 0, leaves: 0, failed: 1 })),
    noteDomainsForSig: vi.fn(),
    getKnownDomains: () => [HOST],
  }
  let landing = false
  committer = {
    update: vi.fn(async () => 'f'.repeat(64)),
    importTree: vi.fn(async () => { if (landing) history.headByLoc.set('loc:' + label, { name: label, children: [] }) }),
  }
  cursor = { state: { rewound: false } }
  opens.mockReset()
  return {
    /** The key arrives: the next open succeeds, keeps the layer, and the broker then finds the closure locally. */
    giveKey: () => {
      opens.mockImplementation(async () => {
        keyed = true
        landing = true
        history.layersBySig.set(SIG, { name: label, children: [] })
        return { ok: true, head: SIG, atoms: 3, host: HOST }
      })
    },
  }
}

beforeEach(() => { localStorage.clear(); queue.clear() })
afterEach(() => { vi.useRealTimers() })

describe('a sealed tile: asked for when the plain bytes are out of reach', () => {
  it('asks with the publisher the queued adopt carries and the hosts the broker knows, and stays unavailable with no key', async () => {
    world('ledger')
    opens.mockResolvedValue({ ok: false, reason: 'no-version' })
    queue.enqueueAll([{ sig: SIG, label: 'ledger', at: [], domain: HOST, pubkey: PUBLISHER }], 'b1')

    const res = await new SwarmAdoptDrone().adoptResolvedBranch({ layerSig: SIG, at: [], domain: HOST, label: 'ledger' })

    // Inspection needs the layers before the fold can ask, so a branch nobody serves stops there.
    expect(res).toBe('uninspectable')
    expect(opens).toHaveBeenCalledWith(SIG, { hosts: [HOST, HOST], publisher: PUBLISHER })
    expect(committer.importTree).not.toHaveBeenCalled()
  })

  it('does not ask at all for an adopt that carries no publisher key — there is no index to read', async () => {
    world('ledger')
    const res = await new SwarmAdoptDrone().adoptResolvedBranch({ layerSig: SIG, at: [], domain: HOST, label: 'ledger' })
    expect(res).toBe('uninspectable')
    expect(opens).not.toHaveBeenCalled()
  })

  it('does not ask when the plain bytes ARE reachable — an ordinary adopt is untouched', async () => {
    world('plain')
    history.layersBySig.set(SIG, { name: 'plain', children: [] })
    broker.adopt = vi.fn(async () => ({ layers: 1, leaves: 0, failed: 0 }))
    committer.importTree = vi.fn(async () => { history.headByLoc.set('loc:plain', { name: 'plain', children: [] }) })
    queue.enqueueAll([{ sig: SIG, label: 'plain', at: [], domain: HOST, pubkey: PUBLISHER }], 'b1')

    const res = await new SwarmAdoptDrone().adoptResolvedBranch({ layerSig: SIG, at: [], domain: HOST, label: 'plain' })

    expect(res).toBe('committed')
    expect(opens).not.toHaveBeenCalled()
  })

  it('finishes the SAME adopt the moment the key opens it', async () => {
    const w = world('ledger')
    w.giveKey()
    queue.enqueueAll([{ sig: SIG, label: 'ledger', at: [], domain: HOST, pubkey: PUBLISHER }], 'b1')

    const res = await new SwarmAdoptDrone().adoptResolvedBranch({ layerSig: SIG, at: [], domain: HOST, label: 'ledger' })

    expect(res).toBe('committed')
    expect(opens).toHaveBeenCalledTimes(1)
    // The key opened it ONCE; every ask after that found the closure local, so the fold was the ordinary one.
    expect(broker.adopt).toHaveBeenCalledWith(SIG, { layersOnly: true })
    expect(committer.importTree).toHaveBeenCalledTimes(1)
    expect(history.headByLoc.get('loc:ledger')).toBeTruthy()
  })
})

// LAST in the file: each new drone instance stays subscribed to tile:action, and its constructor re-enters the drain.
describe('the egg, then the hatch', () => {
  it('lays an egg while no key opens it, keeps the debt owed, and hatches into the tile when the key arrives', async () => {
    const w = world('ledger')
    opens.mockResolvedValue({ ok: false, reason: 'no-version' })
    queue.enqueueAll([{ sig: SIG, label: 'ledger', at: [], domain: HOST, pubkey: PUBLISHER }], 'b1')

    vi.useFakeTimers()
    new SwarmAdoptDrone()                                    // the boot: the constructor resumes the owed queue
    await vi.advanceTimersByTimeAsync(500)

    // No key: the tile is in the hive as an egg (a childless layer, the egg shape), and the adopt is STILL OWED.
    expect(committer.importTree).toHaveBeenCalledTimes(1)
    expect(committer.importTree.mock.calls[0]![0]).toEqual([{ segments: ['ledger'], layer: { name: 'ledger', children: [] } }])
    expect(queue.entries).toHaveLength(1)
    expect(queue.entries[0]!.egg).toBe(true)
    expect(opens).toHaveBeenCalled()

    // The key arrives. Nobody clicks anything: the queue comes back for the egg on its own backoff.
    w.giveKey()
    await vi.advanceTimersByTimeAsync(20_000)

    expect(queue.entries).toHaveLength(0)                    // the debt is paid
    expect(queue.done.map(d => d.label)).toContain('ledger')
    expect(history.headByLoc.get('loc:ledger')).toBeTruthy() // and the tile is in the hive for real
    expect(broker.adopt).toHaveBeenCalledWith(SIG, { layersOnly: true })
  })
})
