// swarm-adopt.stall.spec.ts — one stuck attempt may not hold the whole queue.
//
// The drain is serial, so an attempt that never returns starves every entry behind it: the queue screen read "fetching now"
// for two hours with the next two never tried. The drain now gives each attempt ATTEMPT_MS, defers a stalled one like any
// miss, says which stage it was stuck in, and moves on. The drain is the real one (real queue, real drone, the real lane);
// what is faked is the world around it — the broker, the history and the committer — as in swarm-adopt.sealed.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { OperationQueue } from '../history/operation-queue.service.js'
import type { AdoptQueueService } from './adopt-queue.service.js'

vi.mock('./sealed-adopt.js', () => ({ localizeSealed: vi.fn(async () => ({ ok: false, reason: 'no-version' })) }))

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
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
let lane: OperationQueue | undefined
let queue: AdoptQueueService

const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/SwarmDrone': { peerTilesAtCurrentSig: () => [], subscribedTiles: () => [] },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/LayerCommitter': committer,
  '@diamondcoreprocessor.com/HistoryCursorService': cursor,
  '@diamondcoreprocessor.com/AdoptQueueService': queue,
  '@diamondcoreprocessor.com/OperationQueue': lane,
})

;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: (key: string) => iocRegistry()[key] }

const { _adoptQueue, ATTEMPT_MS } = await import('./adopt-queue.service.js')
const { SwarmAdoptDrone } = await import('./swarm-adopt.drone.js')
queue = _adoptQueue

/** A world where `alpha` and `beta` are plain, reachable branches — except that the broker NEVER answers for `hang`. */
const world = (hang: readonly string[] = []) => {
  history = makeHistory()
  history.headByLoc.set('loc:', { name: 'root', children: [] })
  history.layersBySig.set(SIG_A, { name: 'alpha', children: [] })
  history.layersBySig.set(SIG_B, { name: 'beta', children: [] })
  broker = {
    adopt: vi.fn((sig: string) => hang.includes(sig) ? new Promise(() => undefined) : Promise.resolve({ layers: 1, leaves: 0, failed: 0 })),
    noteDomainsForSig: vi.fn(),
    getKnownDomains: () => [HOST],
  }
  committer = {
    update: vi.fn(async () => 'f'.repeat(64)),
    importTree: vi.fn(async (items: { segments: string[]; layer: Record<string, unknown> }[]) => {
      for (const item of items) history.headByLoc.set('loc:' + item.segments.join('/'), item.layer)
    }),
  }
  cursor = { state: { rewound: false } }
  lane = undefined
}

const owe = (...labels: ('alpha' | 'beta')[]) => queue.enqueueAll(
  labels.map(label => ({ sig: label === 'alpha' ? SIG_A : SIG_B, label, at: [], domain: HOST })),
  'b1',
)

/** What landed since `before` entries were already in the session's done list (it is memory-long and `clear()` keeps it). */
const landedSince = (before: number): string[] => queue.done.slice(0, queue.done.length - before).map(d => d.label)

beforeEach(() => { localStorage.clear(); queue.clear() })
afterEach(() => { vi.useRealTimers() })

describe('the queue keeps where an attempt is', () => {
  it('names a stage only while an attempt is in flight', () => {
    queue.setStage('reach:broker')
    expect(queue.stage).toBeNull()                           // nothing in flight: nothing to name

    owe('alpha')
    queue.setActive(SIG_A, [])
    expect(queue.stage?.name).toBe('starting')
    queue.setStage('reach:broker')
    expect(queue.stage?.name).toBe('reach:broker')

    queue.setActive(null)
    expect(queue.stage).toBeNull()
  })

  it('remembers a stall for the entry until it lands, and forgets it with the entry', () => {
    owe('alpha', 'beta')
    queue.noteStall(SIG_A, [], 'lane')
    queue.noteStall(SIG_B, [], 'reach:broker')
    expect(queue.stalledAt(SIG_A, [])?.stage).toBe('lane')

    queue.complete(SIG_A, [])
    expect(queue.stalledAt(SIG_A, [])).toBeNull()
    expect(queue.stalledAt(SIG_B, [])?.stage).toBe('reach:broker')

    queue.clear()
    expect(queue.stalledAt(SIG_B, [])).toBeNull()
  })
})

// LAST in the file: each new drone instance stays subscribed to tile:action, and its constructor re-enters the drain.
describe('the drain with a stuck attempt', () => {
  it('defers an attempt that never returns, says where it was stuck, and gives the next entry its turn', async () => {
    world([SIG_A])
    owe('alpha', 'beta')
    const before = queue.done.length
    const seen: { stage: string; stalled?: boolean }[] = []
    const off = EffectBus.on<{ stage: string; stalled?: boolean }>('adopt:stage', p => { if (p) seen.push(p) })

    vi.useFakeTimers()
    new SwarmAdoptDrone()                                    // the boot: the constructor resumes the owed queue
    await vi.advanceTimersByTimeAsync(1_000)

    // alpha is stuck inside the broker's read, and beta has not been tried — the screen's old "fetching now" forever.
    expect(queue.entries.map(e => e.label)).toEqual(['alpha', 'beta'])
    expect(queue.stage?.name).toBe('reach:broker')
    expect(queue.entries.find(e => e.label === 'beta')!.tries).toBe(0)

    await vi.advanceTimersByTimeAsync(ATTEMPT_MS)

    expect(landedSince(before)).toEqual(['beta'])            // beta got its turn and landed
    expect(queue.entries.map(e => e.label)).toEqual(['alpha']) // alpha is still owed — never dropped
    expect(queue.entries[0]!.tries).toBe(1)                  // …and backs off like any miss
    expect(queue.stalledAt(SIG_A, [])?.stage).toBe('reach:broker')
    expect(seen.some(p => p.stage === 'reach:broker' && !p.stalled)).toBe(true)
    expect(seen.some(p => p.stage === 'reach:broker' && p.stalled)).toBe(true)
    off()
  })

  it('never begins a turn it already gave up on, and the retry lands once the lane is free', async () => {
    world()
    owe('alpha')
    const before = queue.done.length
    let release!: () => void
    lane = new OperationQueue()
    void lane.run(() => new Promise<void>(resolve => { release = resolve }))   // another act holds the lane

    vi.useFakeTimers()
    new SwarmAdoptDrone()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(queue.stage?.name).toBe('lane')                   // waiting for its turn, and it says so
    expect(broker.adopt).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(ATTEMPT_MS)
    expect(queue.entries[0]!.tries).toBe(1)
    expect(queue.stalledAt(SIG_A, [])?.stage).toBe('lane')

    release()                                                // the lane frees: the abandoned turn comes up LATE
    await vi.advanceTimersByTimeAsync(1_000)
    expect(broker.adopt).not.toHaveBeenCalled()              // …and does nothing

    await vi.advanceTimersByTimeAsync(20_000)                // the backoff passes; the retry has the lane to itself
    expect(queue.entries).toHaveLength(0)
    expect(landedSince(before)).toEqual(['alpha'])
    expect(history.headByLoc.get('loc:alpha')).toBeTruthy()
  })
})
