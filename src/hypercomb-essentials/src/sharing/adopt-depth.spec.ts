// adopt-depth.spec.ts — a visitor paints from the top of the tree.
//
// A published site's arrival shows its root and the first ring of tiles; the
// deeper pages are places the visitor has not asked for yet. `maxDepth` stops
// the layer walk that many TILE levels below the root, so the visit can paint
// after one round of fetches and let the rest stream in behind it
// (hive-visit.boot.drone.ts). Measured on revolucion 2026-09-25: the full walk
// was ~315 layers and ~4 s of round trips before anything could paint.
//
// Pinned here:
//   1. the walk stops at the requested depth and fetches nothing below it;
//   2. a META ENVELOPE is an edge, not a level — stepping through one does not
//      spend depth, or a site whose children are all enveloped would stop at
//      its envelopes and paint no names;
//   3. no maxDepth is the old whole-closure walk.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.boot.drone.js').ContentBrokerDrone

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)
const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const ROOT = SIG('1')
const CHILD_A = SIG('2')
const CHILD_B = SIG('3')
const GRANDCHILD = SIG('4')
const GREAT = SIG('5')
const ENVELOPE = SIG('6')
const ENVELOPED = SIG('7')

let served: Map<string, Uint8Array>
let fetched: string[]

const makeBroker = () => {
  const broker = new ContentBrokerDrone()
  ;(broker as unknown as { fetchBySig: unknown }).fetchBySig = vi.fn(async (sig: string) => {
    fetched.push(sig)
    return served.get(sig) ?? null
  })
  return broker
}

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.boot.drone.js'))
})

beforeEach(() => {
  fetched = []
  served = new Map<string, Uint8Array>([
    [ROOT, json({ name: 'site', cells: [CHILD_A, CHILD_B] })],
    [CHILD_A, json({ name: 'a', cells: [GRANDCHILD] })],
    [CHILD_B, json({ name: 'b', cells: [] })],
    [GRANDCHILD, json({ name: 'g', cells: [GREAT] })],
    [GREAT, json({ name: 'great', cells: [] })],
  ])
})

describe('adopt maxDepth', () => {
  it('stops at the first ring — the root and its children, nothing below', async () => {
    const stats = await makeBroker().adopt(ROOT, { layersOnly: true, quiet: true, maxDepth: 1 })
    expect(new Set(fetched)).toEqual(new Set([ROOT, CHILD_A, CHILD_B]))
    expect(stats.layers).toBe(3)
  })

  it('depth 0 is the root alone', async () => {
    await makeBroker().adopt(ROOT, { layersOnly: true, quiet: true, maxDepth: 0 })
    expect(fetched).toEqual([ROOT])
  })

  it('no maxDepth is the whole closure, as before', async () => {
    const stats = await makeBroker().adopt(ROOT, { layersOnly: true, quiet: true })
    expect(new Set(fetched)).toEqual(new Set([ROOT, CHILD_A, CHILD_B, GRANDCHILD, GREAT]))
    expect(stats.layers).toBe(5)
  })

  it('a meta envelope is an edge, not a level — the tile it names is still in the first ring', async () => {
    const { mintMetaEnvelope, isMetaEnvelope } = await import('@hypercomb/core')
    const envelope = mintMetaEnvelope({ layer: ENVELOPED })
    expect(isMetaEnvelope(envelope)).toBe(true)
    served.set(ROOT, json({ name: 'site', cells: [ENVELOPE] }))
    served.set(ENVELOPE, json(envelope))
    served.set(ENVELOPED, json({ name: 'enveloped', cells: [GREAT] }))
    const stats = await makeBroker().adopt(ROOT, { layersOnly: true, quiet: true, maxDepth: 1 })
    expect(fetched).toContain(ENVELOPED)
    expect(fetched).not.toContain(GREAT)
    // the envelope is walked through, never counted as a tile
    expect(stats.layers).toBe(2)
  })
})
