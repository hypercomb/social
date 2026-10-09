// keep-alive.queen.spec.ts — the hive stays awake and pulsing while it is on,
// takes the screen lock again whenever the tab shows, and lets go when off.

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const acts = vi.hoisted(() => ({ count: 0 }))
vi.mock('@hypercomb/core', async (original) => {
  const real = await original<typeof import('@hypercomb/core')>()
  return { ...real, hypercomb: class { act = async () => { acts.count++ } } }
})

type Lock = { released: boolean; release: () => Promise<void> }
const locks: Lock[] = []
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  acts.count = 0
  locks.splice(0)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: vi.fn(async () => {
        const lock: Lock = { released: false, release: async () => { lock.released = true } }
        locks.push(lock)
        return lock
      }),
    },
  })
  const registry = new Map<string, unknown>()
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => registry.set(key, value),
    get: (key: string) => registry.get(key),
    whenReady: () => {},
  }
})

afterEach(() => { vi.useRealTimers(); vi.resetModules() })

const show = async (state: DocumentVisibilityState): Promise<void> => {
  visibility = state
  // The browser releases the screen lock of a hidden page on its own.
  if (state === 'hidden') for (const lock of locks) lock.released = true
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
}

it('holds the screen and pulses the hive while on, and lets both go when off', async () => {
  const { KeepAlive, KEEP_ALIVE_PULSE_MS } = await import('./keep-alive.queen')
  const keeper = new KeepAlive()
  await keeper.start()
  expect(keeper.on).toBe(true)
  expect(keeper.awake).toBe(true)
  await vi.advanceTimersByTimeAsync(KEEP_ALIVE_PULSE_MS * 3)
  expect(acts.count).toBe(3)

  await keeper.stop()
  expect(keeper.on).toBe(false)
  expect(locks[0]!.released).toBe(true)
  await vi.advanceTimersByTimeAsync(KEEP_ALIVE_PULSE_MS * 3)
  expect(acts.count).toBe(3)
})

it('takes the screen again when the tab shows, and pulses at once on return', async () => {
  const { KeepAlive } = await import('./keep-alive.queen')
  const keeper = new KeepAlive()
  await keeper.start()
  await show('hidden')
  expect(keeper.awake).toBe(false)
  const before = acts.count
  await show('visible')
  expect(keeper.awake).toBe(true)
  expect(locks).toHaveLength(2)
  expect(acts.count).toBe(before + 1)
  await keeper.stop()
})

it('is on even where the browser cannot hold the screen, and says it is not holding it', async () => {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined })
  const { KeepAlive, KEEP_ALIVE_PULSE_MS } = await import('./keep-alive.queen')
  const keeper = new KeepAlive()
  await keeper.start()
  expect(keeper.on).toBe(true)
  expect(keeper.awake).toBe(false)
  await vi.advanceTimersByTimeAsync(KEEP_ALIVE_PULSE_MS)
  expect(acts.count).toBe(1)
  await keeper.stop()
})
