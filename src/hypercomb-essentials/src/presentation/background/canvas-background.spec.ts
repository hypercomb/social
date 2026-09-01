// presentation/background/canvas-background.spec.ts
//
// THE BACKDROP MUST SURVIVE A SLOW BOOT, AND IT MUST TRAVEL WITH THE HIVE.
//
// Both halves are one bug seen from two sides. The screen picture was held as
// a signature in localStorage and nowhere else, and it was resolved on a fixed
// eight-second ladder. On a large hive the store settles after that deadline,
// so the read gave up, the screen fell back to a pattern, and the preference
// went on naming a picture that was sitting right there — "I keep losing my
// background". And because nothing in the hive referenced those bytes, the
// same picture was litter to every collector in this system.
//
// These four cases pin the fix: wait for the store rather than time it, mirror
// the choice into `backgrounds:screen` so the signature is REFERENCED content,
// and let that pool speak only where nothing local does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORE_KEY = '@hypercomb.social/Store'
const PREF_KEY = 'hc:canvas-bg'
const SCREEN_POOL = 'backgrounds:screen'
const SIG_A = 'a1'.repeat(32)
const SIG_B = 'b2'.repeat(32)

type FakePool = { meaning: string }

type FakeStore = {
  initialize(): Promise<void>
  getResource(sig: string): Promise<Blob | null>
  putResource(blob: Blob): Promise<string>
  getPool(meaning: string): Promise<FakePool | null>
  getPoolDoc(pool?: FakePool): Promise<ArrayBuffer | null>
  putPoolDoc(pool: FakePool, bytes: ArrayBuffer): Promise<string | null>
  docs: Record<string, string>
}

/** A store that behaves like the real one on the two counts that matter: it is
 *  registered in IoC before OPFS is open, and until it is open every read
 *  answers empty rather than throwing. `settleAfterMs` is how long the shell
 *  takes to get there — the number the old ladder was guessing at. */
const fakeStore = (options: {
  settleAfterMs?: number
  resources?: Record<string, Blob>
  docs?: Record<string, string>
} = {}): FakeStore => {
  const docs: Record<string, string> = { ...(options.docs ?? {}) }
  const resources = options.resources ?? {}
  let open = false
  let opening: Promise<void> | null = null
  return {
    docs,
    initialize: () => opening ??= new Promise<void>(resolve => {
      setTimeout(() => { open = true; resolve() }, options.settleAfterMs ?? 0)
    }),
    getResource: async (sig: string) => (open ? resources[sig] ?? null : null),
    putResource: async (blob: Blob) => { resources[SIG_B] = blob; return SIG_B },
    getPool: async (meaning: string) => (open ? { meaning } : null),
    getPoolDoc: async (pool?: FakePool) => {
      const text = pool ? docs[pool.meaning] : undefined
      return text === undefined ? null : new TextEncoder().encode(text).buffer as ArrayBuffer
    },
    putPoolDoc: async (pool: FakePool, bytes: ArrayBuffer) => {
      docs[pool.meaning] = new TextDecoder().decode(bytes)
      return 'written'
    },
  }
}

const register = (store: FakeStore | null): void => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => (key === STORE_KEY ? store ?? undefined : undefined),
    register: () => { /* the module registers itself on import */ },
  }
}

// The module registers a singleton of its own at import. Park it on a store
// that never opens, so it can never touch a pool a test is asserting on: it
// resolves its registration, awaits an initialize that never settles, and
// stops there. Every test then builds its OWN instance against its own store.
register({
  ...fakeStore(),
  initialize: () => new Promise<void>(() => { /* never */ }),
})
const { CanvasBackgroundService } = await import('./canvas-background.service.js')

const screenDoc = (store: FakeStore): { picture?: string; dim?: number; zoom?: number } | null => {
  const raw = store.docs[SCREEN_POOL]
  return raw === undefined ? null : JSON.parse(raw)
}

describe('the screen backdrop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    // jsdom has no object URLs, and this service holds one as its session
    // handle on the bytes. A non-empty swatch IS "the picture resolved".
    URL.createObjectURL = (() => 'blob:picture') as typeof URL.createObjectURL
    URL.revokeObjectURL = (() => { /* nothing to revoke */ }) as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.useRealTimers()
    register(null)
  })

  it('resolves a picture from a store that settles long after the old eight-second ladder', async () => {
    localStorage.setItem(PREF_KEY, JSON.stringify({ picture: SIG_A, dim: 0, zoom: 1, v: 2 }))
    const store = fakeStore({ settleAfterMs: 20_000, resources: { [SIG_A]: new Blob(['picture']) } })
    register(store)

    const service = new CanvasBackgroundService()
    // Where the ladder used to expire: the store is still opening, and the
    // signature is still the truth — nothing has been cleared.
    await vi.advanceTimersByTimeAsync(9_000)
    expect(service.picture).toBe(SIG_A)
    expect(service.pictureSwatch()).toBe('')

    await vi.advanceTimersByTimeAsync(15_000)
    expect(service.pictureSwatch()).toContain('blob:picture')
  })

  it('mirrors the choice into its pool of meaning, so the signature is referenced content', async () => {
    const store = fakeStore({ resources: { [SIG_A]: new Blob(['picture']) } })
    register(store)

    const service = new CanvasBackgroundService()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await service.setPicture(SIG_A)).toBe(true)
    service.setDim(0.25)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(screenDoc(store)).toMatchObject({ picture: SIG_A, dim: 0.25 })
  })

  it('adopts the backdrop a hive arrived carrying when nothing local names one', async () => {
    const store = fakeStore({
      resources: { [SIG_A]: new Blob(['picture']) },
      docs: { [SCREEN_POOL]: JSON.stringify({ picture: SIG_A, dim: 0.5, zoom: 1.5, panX: 0, panY: 0 }) },
    })
    register(store)

    const service = new CanvasBackgroundService()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(service.picture).toBe(SIG_A)
    expect(service.pictureSwatch()).toContain('blob:picture')
    // And it is written back to the pref, so the next boot paints instantly.
    expect(JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}').picture).toBe(SIG_A)
  })

  it('never overrules a local choice with the pool', async () => {
    localStorage.setItem(PREF_KEY, JSON.stringify({ picture: SIG_A, dim: 0, zoom: 1, v: 2 }))
    const store = fakeStore({
      resources: { [SIG_A]: new Blob(['mine']), [SIG_B]: new Blob(['theirs']) },
      docs: { [SCREEN_POOL]: JSON.stringify({ picture: SIG_B, dim: 0, zoom: 1, panX: 0, panY: 0 }) },
    })
    register(store)

    const service = new CanvasBackgroundService()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(service.picture).toBe(SIG_A)
  })
})
