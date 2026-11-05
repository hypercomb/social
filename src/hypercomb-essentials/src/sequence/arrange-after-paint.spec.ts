// TILES FIRST, THEN THE ARRANGEMENT.
//
// A page paints in batches. The arrange cycle repacks whatever the last batch
// published, so arranging mid-reveal laid out the tiles that happened to be on
// screen and let the rest land on top of them — the page visibly tore itself
// apart, and the index writes that followed were computed against that partial
// set. Arranging now waits for the pass to settle.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registry = new Map<string, any>()

// Where the participant is. The renderer reads its target from the lineage, so
// the lineage always moves BEFORE a pass is aimed at the new page.
let segments: string[] = ['here']

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
    segments = ['here']
    registry.set('@hypercomb.social/Lineage', { explorerSegments: () => segments })
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

  it('stays open through a re-render of the same page (arranging is never one-shot)', async () => {
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: 20 })
    EffectBus.emit('render:cell-count', cellCount({ settled: true, renderPassId: 20 }))
    await press()
    expect(arranged).toHaveLength(1)

    // The arrange's own commit re-renders this page; that pass may end
    // without publishing a snapshot at all.
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: 21 })
    await press()
    await press()
    expect(arranged).toHaveLength(3)
  })

  it('closes again when the next page starts painting', async () => {
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: 22 })
    EffectBus.emit('render:cell-count', cellCount({ settled: true, renderPassId: 22 }))
    await press()
    expect(arranged).toHaveLength(1)

    segments = ['there']
    EffectBus.emit('render:tiles-target', { locationKey: 'there', renderPassId: 23 })
    await press()
    expect(arranged).toHaveLength(1)
  })
})

// The drone is a module singleton and drops a snapshot older than the newest it
// has seen, so every snapshot published in here takes the next pass id.
let pass = 100
const nextPass = (): number => ++pass

// The newest TARGET is where a pass was aimed, not where the participant is.
// These run on fake timers so "no wait" and "no early release" are provable.
describe('the gate follows the page the participant is on, and the watchdog is a net for a dead pass', () => {
  let arranged: unknown[]
  let stopWatching: (() => void) | undefined
  let warn: ReturnType<typeof vi.spyOn>
  let PAINT_SETTLE_TIMEOUT = 0

  beforeEach(async () => {
    registry.set('@diamondcoreprocessor.com/AxialService', {
      items: new Map(COORDS.map((c, i) => [i, c])),
    })
    segments = ['here']
    registry.set('@hypercomb.social/Lineage', { explorerSegments: () => segments })
    registry.set('@diamondcoreprocessor.com/SequenceService', { list: () => [], get: () => null })

    const mod = await import('./sequence-cycle.drone.js')
    PAINT_SETTLE_TIMEOUT = mod.PAINT_SETTLE_TIMEOUT
    const drone = registry.get('@diamondcoreprocessor.com/SequenceCycleDrone')
    await drone.heartbeat()

    // Settle 'here' on real timers first: that disarms whatever an earlier
    // test left running, so the fake clock never has to clear a real handle.
    const first = nextPass()
    EffectBus.emit('render:tiles-target', { locationKey: 'here', renderPassId: first })
    EffectBus.emit('render:cell-count', cellCount({ settled: true, renderPassId: first }))

    vi.useFakeTimers()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: unknown[] = []
    arranged = seen
    stopWatching = EffectBus.on('sequence:selected', (p: any) => { seen.push(p) })
    seen.length = 0
  })

  afterEach(() => {
    stopWatching?.(); stopWatching = undefined
    warn.mockRestore()
    vi.useRealTimers()
  })

  const press = async () => {
    EffectBus.emit('keymap:invoke', { cmd: 'sequence.cycle' })
    await vi.advanceTimersByTimeAsync(0)
  }

  it('is open on a painted page whose neighbour was targeted and then abandoned', async () => {
    // Step into B; its pass is aimed (target) but never paints...
    segments = ['there']
    EffectBus.emit('render:tiles-target', { locationKey: 'there', renderPassId: 31 })
    // ...and the participant steps straight back to A. A is already on screen
    // and unchanged, so the renderer skips it: no target, no snapshot.
    segments = ['here']

    await press()
    expect(arranged).toHaveLength(1)   // old gate: shut until the watchdog fired

    await vi.advanceTimersByTimeAsync(PAINT_SETTLE_TIMEOUT * 2)
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays shut through a slow hold, then opens when the page settles', async () => {
    // B's pass holds its paint (completeness gate) and re-targets as it retries.
    segments = ['there']
    EffectBus.emit('render:tiles-target', { locationKey: 'there', renderPassId: 40 })
    await vi.advanceTimersByTimeAsync(2000)
    EffectBus.emit('render:tiles-target', { locationKey: 'there', renderPassId: 41 })
    await vi.advanceTimersByTimeAsync(2000)
    const last = nextPass()
    EffectBus.emit('render:tiles-target', { locationKey: 'there', renderPassId: last })

    // Past the old 3 s window: A's tiles are still what is on screen, so
    // arranging now would write A's order under B's address.
    await press()
    expect(arranged).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()

    EffectBus.emit('render:cell-count', cellCount({ settled: true, renderPassId: last, locationKey: 'there' }))
    await press()
    expect(arranged).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('still releases, loudly, for a pass that never settles', async () => {
    segments = ['there']
    EffectBus.emit('render:tiles-target', { locationKey: 'there', renderPassId: 50 })

    await vi.advanceTimersByTimeAsync(PAINT_SETTLE_TIMEOUT - 1)
    await press()
    expect(arranged).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('tile pass never settled')

    await press()
    expect(arranged).toHaveLength(1)
  })

  it('a refused press arms the watchdog even when no effect announced the closing', async () => {
    // The lineage moved but the pass has not been aimed yet (or never is).
    segments = ['there']
    await press()
    expect(arranged).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(PAINT_SETTLE_TIMEOUT)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
