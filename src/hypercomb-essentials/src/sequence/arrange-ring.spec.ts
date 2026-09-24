// THE LAYOUT RING.
//
// Pressing `a` used to keep one session-only "Initial" snapshot, and a drag,
// an add or a remove threw it away — exactly when the way back was needed.
// Every press now saves the layout on screen into a per-location ring (unless
// the cycle itself produced it), and cycling onward restores each one.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, any>()

beforeAll(() => {
  Object.defineProperty(window, 'ioc', {
    configurable: true,
    value: {
      get: (key: string) => registry.get(key),
      register: (key: string, value: unknown) => registry.set(key, value),
      whenReady: () => {},
    },
  })
})

const COORDS = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: 1, r: -1 }]
const LABELS = ['alpha', 'beta', 'gamma', 'delta']

let pass = 100
const show = (labels: string[], slots: number[]) => {
  pass++
  EffectBus.emit('render:tiles-target', { locationKey: 'ring-here', renderPassId: pass })
  EffectBus.emit('render:cell-count', {
    count: labels.length, labels, coords: slots.map((s) => COORDS[s]),
    locationKey: 'ring-here', settled: true, renderPassId: pass,
  })
}

const ringHere = (): Record<string, number>[] =>
  JSON.parse(localStorage.getItem('hc:arrange-ring') ?? '{}')['ring-here'] ?? []

describe('the arrange layout ring', () => {
  beforeEach(async () => {
    localStorage.removeItem('hc:arrange-ring')
    localStorage.removeItem('hc:arrange-active')
    registry.set('@diamondcoreprocessor.com/AxialService', {
      items: new Map(COORDS.map((c, i) => [i, c])),
    })
    registry.set('@hypercomb.social/Lineage', { explorerSegments: () => ['ring-here'] })
    registry.set('@diamondcoreprocessor.com/SequenceService', { list: () => [], get: () => null })
    await import('./sequence-cycle.drone.js')
    await registry.get('@diamondcoreprocessor.com/SequenceCycleDrone').heartbeat()
  })

  const press = async () => {
    EffectBus.emit('keymap:invoke', { cmd: 'sequence.cycle' })
    await new Promise(r => setTimeout(r, 0))
  }

  it('saves the hand-made layout on the first press, and only once', async () => {
    show(LABELS, [3, 0, 2, 1])
    await press()
    expect(ringHere()).toEqual([{ alpha: 3, beta: 0, gamma: 2, delta: 1 }])

    // Pressing again from the same hand-made layout does not duplicate it.
    show(LABELS, [3, 0, 2, 1])
    await press()
    expect(ringHere()).toHaveLength(1)
  })

  it('keeps earlier layouts across a drag, newest first', async () => {
    show(LABELS, [3, 0, 2, 1])
    await press()
    show(LABELS, [1, 3, 0, 2])  // a drag the participant made afterwards
    await press()
    expect(ringHere()).toEqual([
      { alpha: 1, beta: 3, gamma: 0, delta: 2 },
      { alpha: 3, beta: 0, gamma: 2, delta: 1 },
    ])
  })
})

describe('restorePlacement', () => {
  it('returns every known tile to its slot and packs new tiles into free slots', async () => {
    const { restorePlacement } = await import('./sequence-cycle.drone.js')
    const saved = new Map([['alpha', 2], ['beta', 0], ['gone', 1]])
    const restored = restorePlacement(saved, ['beta', 'alpha', 'fresh'])
    expect([...restored]).toEqual([['beta', 0], ['alpha', 2], ['fresh', 1]])
  })
})
