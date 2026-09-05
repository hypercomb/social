// TILES FIRST, THEN THE ARRANGEMENT.
//
// A page paints in batches. The arrange cycle repacks whatever the last batch
// published, so arranging mid-reveal laid out the tiles that happened to be on
// screen and let the rest land on top of them — the page visibly tore itself
// apart, and the index writes that followed were computed against that partial
// set. Arranging now waits for the pass to settle.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

const COORDS = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }]
const LABELS = ['alpha', 'beta', 'gamma', 'delta']

const cellCount = (extra: Record<string, unknown>) => ({
  count: LABELS.length, labels: LABELS, coords: COORDS, locationKey: 'here', ...extra,
})

describe('arrange waits for the tiles to come into view', () => {
  let arranged: unknown[]
  let stopWatching: (() => void) | undefined

  afterEach(() => { stopWatching?.(); stopWatching = undefined })

  beforeEach(async () => {
    registry.set('@diamondcoreprocessor.com/AxialService', {
      items: new Map(COORDS.map((c, i) => [i, c])),
    })
    registry.set('@hypercomb.social/Lineage', { explorerSegments: () => ['here'] })
    registry.set('@diamondcoreprocessor.com/SequenceService', { list: () => [], get: () => null })

    await import('./sequence-cycle.drone.js')
    const drone = registry.get('@diamondcoreprocessor.com/SequenceCycleDrone')
      ?? registry.get('@sequence/sequence-cycle.drone')
    await drone.heartbeat()

    // Captured by value: the drone is a module singleton, so a listener that
    // closed over the outer binding would keep pushing into whichever array
    // the newest test had installed.
    const seen: unknown[] = []
    arranged = seen
    stopWatching = EffectBus.on('sequence:selected', (p: any) => { seen.push(p) })
    seen.length = 0   // drop the last-value replay
  })

  const press = async () => {
    EffectBus.emit('keymap:invoke', { cmd: 'sequence.cycle' })
    await new Promise(r => setTimeout(r, 0))
  }

  it('refuses while a targeted pass is still painting', async () => {
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: 10 })
    EffectBus.emit('render:cell-count', cellCount({ settled: false, renderPassId: 10 }))

    await press()
    expect(arranged).toHaveLength(0)
  })

  it('arranges once the final batch lands', async () => {
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: 11 })
    EffectBus.emit('render:cell-count', cellCount({ settled: false, renderPassId: 11 }))
    await press()
    expect(arranged).toHaveLength(0)

    EffectBus.emit('render:cell-count', cellCount({ settled: true, renderPassId: 11 }))
    await press()
    expect(arranged).toHaveLength(1)
  })

  it('is not re-closed by a post-paint touch-up that carries no settled flag', async () => {
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: 12 })
    EffectBus.emit('render:cell-count', cellCount({ settled: true, renderPassId: 12 }))

    // An image landing / a shade flip republishes the snapshot with no flag.
    EffectBus.emit('render:cell-count', cellCount({ renderPassId: 12 }))

    await press()
    expect(arranged).toHaveLength(1)
  })

  it('closes again when the next page starts painting', async () => {
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: 13 })
    EffectBus.emit('render:cell-count', cellCount({ settled: true, renderPassId: 13 }))
    await press()
    expect(arranged).toHaveLength(1)

    EffectBus.emit('render:tiles-target', { locationKey: 'there', renderPassId: 14 })
    await press()
    expect(arranged).toHaveLength(1)
  })
})
