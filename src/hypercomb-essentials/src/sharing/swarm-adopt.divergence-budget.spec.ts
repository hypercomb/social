// swarm-adopt.divergence-budget.spec.ts — a divergence pass is bounded (SCALE-5).
//
// A hive that holds a hundred names a peer also offers (a workshop on one
// template, or a page taken earlier) used to probe every one of them in one
// pass: a cached-visuals ask one level in (rule 3) and a layers-only walk of
// the publisher's branch (rule 4) per held tile — about 1,500 frames in 16 s,
// a thousand of them refused by the relay. Pinned here:
//   1. one pass makes at most 8 probes;
//   2. a pass cut short schedules the next, which starts where the first ran
//      out of probes;
//   3. a held tile whose layer sig IS the offer's is never probed.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.mock('./membership.js', () => ({ isJoinedHere: () => false }))

const N = 120
const PUB = 'a'.repeat(64)
const nameOf = (i: number): string => `s0-t${String(i).padStart(3, '0')}`
const hex = (prefix: string, i: number): string => prefix.repeat(61) + String(i).padStart(3, '0')
const heldSig = (i: number): string => hex('b', i)
const theirSig = (i: number): string => hex('c', i)
const childLocation = (name: string): string => hex('d', Number(name.slice(-3)))

let offered: { name: string; peerPubkey: string; layerSig: string }[] = []
const prime = vi.fn(async (_sig: string) => undefined)
const adopt = vi.fn(async (_sig: string) => ({ layers: 0, leaves: 0, failed: 1 }))

const parent = { name: '', children: Array.from({ length: N }, (_, i) => heldSig(i)) }
const history = {
  sign: async () => 'loc:root',
  currentLayerAt: async (loc: string) => (loc === 'loc:root' ? parent : null),
  getLayerBySig: async (sig: string) => {
    const i = parent.children.indexOf(sig)
    return i >= 0 ? { name: nameOf(i), children: [] } : null
  },
  commitLayer: async () => 'e'.repeat(64),
}

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/SwarmDrone': {
    peerTilesAtCurrentSig: () => offered,
    subscribedTiles: () => [],
    peerTilesAtSig: () => [],
    composeSigForSegments: async (segments: readonly string[]) => childLocation(String(segments[segments.length - 1])),
    primePeerTilesAt: prime,
  },
  '@hypercomb.social/Lineage': { explorerSegments: () => [], domain: () => 'hypercomb.io' },
  '@diamondcoreprocessor.com/ContentBrokerDrone': { adopt, noteDomainsForSig: () => void 0, getKnownDomains: () => [] },
  '@diamondcoreprocessor.com/HistoryService': history,
  '@diamondcoreprocessor.com/HistoryCursorService': { state: { rewound: false } },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => registry[key],
}

const probes = (): number => prime.mock.calls.length + adopt.mock.calls.length
const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve))
}

beforeAll(async () => {
  // The module registers the one drone this spec drives.
  await import('./swarm-adopt.drone.js')
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  prime.mockClear()
  adopt.mockClear()
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the divergence scan probes a bounded number of held tiles per pass (SCALE-5)', () => {
  it('120 held names a peer also offers: 8 probes a pass, the next pass reaches further', async () => {
    offered = Array.from({ length: N }, (_, i) => ({ name: nameOf(i), peerPubkey: PUB, layerSig: theirSig(i) }))
    EffectBus.emit('swarm:peers-changed', {})
    await vi.advanceTimersByTimeAsync(4_000)
    await settle()
    expect(probes()).toBeGreaterThan(0)
    expect(probes()).toBeLessThanOrEqual(8)
    const first = new Set([...prime.mock.calls.map(c => c[0]), ...adopt.mock.calls.map(c => c[0])])

    // Cut short, the pass scheduled the next itself.
    prime.mockClear()
    adopt.mockClear()
    await vi.advanceTimersByTimeAsync(10_000)
    await settle()
    expect(probes()).toBeLessThanOrEqual(8)
    // It starts where the first ran out: at most the one tile the first pass
    // was part-way through is asked about again.
    const again = [...prime.mock.calls.map(c => c[0]), ...adopt.mock.calls.map(c => c[0])].filter(sig => first.has(sig))
    expect(again.length).toBeLessThanOrEqual(1)
    expect(probes() - again.length).toBeGreaterThanOrEqual(6)
  })

  it('a held tile whose layer sig is the offer\'s own is never probed', async () => {
    // The same names, the same bytes: nothing beneath any of them can differ.
    offered = Array.from({ length: N }, (_, i) => ({ name: nameOf(i), peerPubkey: 'f'.repeat(64), layerSig: heldSig(i) }))
    EffectBus.emit('swarm:peers-changed', {})
    await vi.advanceTimersByTimeAsync(4_000)
    await settle()
    expect(probes()).toBe(0)
  })
})
