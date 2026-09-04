import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { awaitFirstTilePaint } from './first-tile-paint'

// Real timers, small windows. The thing under test IS timing, and a fake
// clock that also has to fake requestAnimationFrame would be testing the
// harness as much as the barrier.
const FAST = { silenceMs: 80, ceilingMs: 5_000, frameMs: 10 } as const

const tick = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Watch a promise without awaiting it. */
const track = (promise: Promise<void>): { readonly done: boolean } => {
  const state = { done: false }
  void promise.then(() => { state.done = true })
  return state
}

const paint = (locationKey: string, settled: boolean): void => {
  EffectBus.emit('render:cell-count', { locationKey, settled, count: 0 })
}

describe('first tile paint barrier', () => {
  let warn: ReturnType<typeof vi.spyOn>
  const realRaf = globalThis.requestAnimationFrame

  beforeEach(() => {
    EffectBus.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    globalThis.requestAnimationFrame = realRaf
    EffectBus.clear()
  })

  it('opens on the settled frame for the location being restored', async () => {
    const barrier = track(awaitFirstTilePaint('/business/people', FAST))
    await tick(5)
    expect(barrier.done).toBe(false)

    paint('/business/people', true)
    await tick(30)
    expect(barrier.done).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores an unsettled frame and another location\'s settled frame', async () => {
    const barrier = track(awaitFirstTilePaint('/', FAST))

    paint('/', false)
    paint('/somewhere-else', true)
    await tick(30)
    expect(barrier.done).toBe(false)

    paint('/', true)
    await tick(30)
    expect(barrier.done).toBe(true)
  })

  // The bug this exists for: the frame never came, and every background
  // behaviour — the Claude bridge among them — stayed unstarted for the life
  // of the page with no error anywhere.
  it('gives up when the renderer never settles, and says so', async () => {
    const barrier = track(awaitFirstTilePaint('/', FAST))
    await tick(30)
    expect(barrier.done).toBe(false)

    await tick(120)
    expect(barrier.done).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('never settled'))
  })

  // A cold profile can take seconds to paint and deserves the wait. Silence,
  // not elapsed time, is what says nothing is coming.
  it('waits again for a renderer that is still working', async () => {
    const barrier = track(awaitFirstTilePaint('/', FAST))

    // Well past the 80ms silence window, but the renderer keeps reporting.
    for (let i = 0; i < 8; i++) {
      paint('/', false)
      await tick(25)
    }
    expect(barrier.done).toBe(false)

    paint('/', true)
    await tick(30)
    expect(barrier.done).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it('still bounds a renderer that talks about somewhere else forever', async () => {
    const barrier = track(awaitFirstTilePaint('/', { silenceMs: 5_000, ceilingMs: 100, frameMs: 10 }))

    for (let i = 0; i < 10; i++) {
      paint('/elsewhere', true)
      await tick(20)
    }
    expect(barrier.done).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('never settled'))
  })

  // A backgrounded tab is never served an animation frame, so the settled
  // frame would arrive and the handoff would never run.
  it('opens when the frame arrives but no animation frame ever does', async () => {
    globalThis.requestAnimationFrame = (() => 0) as typeof globalThis.requestAnimationFrame
    const barrier = track(awaitFirstTilePaint('/', FAST))

    paint('/', true)
    await tick(40)
    expect(barrier.done).toBe(true)
    // A paint that landed is not a give-up, however it was handed off.
    expect(warn).not.toHaveBeenCalled()
  })

  it('opens on a settled frame that was already emitted before it subscribed', async () => {
    paint('/', true)
    const barrier = track(awaitFirstTilePaint('/', FAST))
    await tick(30)
    expect(barrier.done).toBe(true)
  })

  it('stops listening once it opens', async () => {
    const barrier = track(awaitFirstTilePaint('/', FAST))
    paint('/', true)
    await tick(30)
    expect(barrier.done).toBe(true)

    // Past the silence window with the barrier already open: the give-up
    // timer was cleared, and no late frame can reach a released barrier.
    paint('/', false)
    await tick(120)
    expect(warn).not.toHaveBeenCalled()
  })
})
