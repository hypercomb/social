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
  reads: string[]
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
  const reads: string[] = []
  return {
    docs,
    reads,
    initialize: () => opening ??= new Promise<void>(resolve => {
      setTimeout(() => { open = true; resolve() }, options.settleAfterMs ?? 0)
    }),
    getResource: async (sig: string) => { reads.push(sig); return open ? resources[sig] ?? null : null },
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

    // Long enough for the store to settle AND for the picture to get ready:
    // the session handle is installed when the picture can be shown whole, not
    // when its bytes land. jsdom loads no images, so that is the ready cap.
    await vi.advanceTimersByTimeAsync(20_000)
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

    // One record per path — `[]` is the hive's own root.
    expect(screenDoc(store)).toMatchObject({ records: { '[]': { picture: SIG_A, dim: 0.25 } } })
  })

  it('adopts the backdrop a hive arrived carrying when nothing local names one', async () => {
    const store = fakeStore({
      resources: { [SIG_A]: new Blob(['picture']) },
      docs: { [SCREEN_POOL]: JSON.stringify({ picture: SIG_A, dim: 0.5, zoom: 1.5, panX: 0, panY: 0 }) },
    })
    register(store)

    const service = new CanvasBackgroundService()
    // Past the ready cap: the handle is installed when the picture can be
    // shown whole (see the one-paint case below), not when its bytes land.
    await vi.advanceTimersByTimeAsync(6_000)

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

  /** jsdom loads no images. This one does, on the next tick, at a size worth
   *  measuring — everything here turns on what the body wore at which moment. */
  const loadableImages = (width = 1200, height = 800): { restore: () => void; made: () => number } => {
    const real = globalThis.Image
    let made = 0
    globalThis.Image = class {
      naturalWidth = width
      naturalHeight = height
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() { made++ }
      decode(): Promise<void> { return Promise.resolve() }
      set src(_url: string) { setTimeout(() => this.onload?.(), 0) }
    } as unknown as typeof Image
    return { restore: () => { globalThis.Image = real }, made: () => made }
  }

  // "You click the button and the image resizes to the middle — the same
  // image — and then when the new one comes up it flips to the other one."
  //
  // Choosing a picture dropped the one showing on the spot, taking its
  // measured size and its mirrored strip with it, so the same photograph fell
  // back to the whole-picture `contain` fit and sat there, small and centred,
  // until its replacement arrived. The old picture is left ALONE now.
  it('leaves the picture showing exactly as it is until the new one is ready', async () => {
    const store = fakeStore({ resources: { [SIG_A]: new Blob(['first']), [SIG_B]: new Blob(['second']) } })
    register(store)
    const images = loadableImages()
    let handles = 0
    URL.createObjectURL = (() => `blob:picture-${++handles}`) as typeof URL.createObjectURL

    try {
      const service = new CanvasBackgroundService()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await service.setPicture(SIG_A)).toBe(true)
      await vi.advanceTimersByTimeAsync(1_000)
      const showing = {
        image: document.body.style.backgroundImage,
        size: document.body.style.backgroundSize,
        position: document.body.style.backgroundPosition,
      }
      expect(showing.image).toContain('blob:picture')
      expect(showing.size).not.toContain('contain')

      expect(await service.setPicture(SIG_B)).toBe(true)
      // Not one timer advanced: the body is wearing what it was wearing.
      expect(document.body.style.backgroundImage).toBe(showing.image)
      expect(document.body.style.backgroundSize).toBe(showing.size)
      expect(document.body.style.backgroundPosition).toBe(showing.position)

      // And when the new one is ready it is the only thing that changes.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(document.body.style.backgroundImage).not.toBe(showing.image)
      expect(document.body.style.backgroundSize).not.toContain('contain')
    } finally {
      images.restore()
    }
  })

  // AND NOT FOR A PAGE NEXT DOOR EITHER. The screen records name the backdrop
  // of every page that has one, so the nearest ones on this branch are read
  // and built in the quiet after boot — without being shown, and without
  // disturbing the picture that is.
  it('gets the neighbouring pages ready without showing them', async () => {
    const store = fakeStore({
      resources: { [SIG_A]: new Blob(['here']), [SIG_B]: new Blob(['next door']) },
      docs: {
        [SCREEN_POOL]: JSON.stringify({
          v: 2,
          records: {
            '[]': { picture: SIG_A, dim: 0, zoom: 1, panX: 0, panY: 0, cascade: false },
            '["projects"]': { picture: SIG_B, dim: 0, zoom: 1, panX: 0, panY: 0, cascade: true },
          },
        }),
      },
    })
    register(store)
    const images = loadableImages()

    try {
      const service = new CanvasBackgroundService()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(service.picture).toBe(SIG_A)
      expect(store.reads).not.toContain(SIG_B)

      // The quiet after: the page next door is read and built.
      await vi.advanceTimersByTimeAsync(3_000)
      expect(store.reads).toContain(SIG_B)
      // And it stays off the screen — this page's picture is still this
      // page's picture.
      expect(service.picture).toBe(SIG_A)
    } finally {
      images.restore()
    }
  })

  // "There's always gonna be latency for the image to show" — not for one you
  // were just wearing. A signature names the same bytes forever, so a picture
  // prepared this session is put back on WITHOUT a read, a decode or a second
  // strip: the frame the page changes is the frame the backdrop changes.
  it('puts a picture it already prepared back on with no further work', async () => {
    const store = fakeStore({ resources: { [SIG_A]: new Blob(['first']), [SIG_B]: new Blob(['second']) } })
    register(store)
    const images = loadableImages()
    let handles = 0
    URL.createObjectURL = (() => `blob:picture-${++handles}`) as typeof URL.createObjectURL

    try {
      const service = new CanvasBackgroundService()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await service.setPicture(SIG_A)).toBe(true)
      await vi.advanceTimersByTimeAsync(1_000)
      const first = document.body.style.backgroundImage
      expect(first).toContain('blob:picture')

      expect(await service.setPicture(SIG_B)).toBe(true)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(document.body.style.backgroundImage).not.toBe(first)
      const spent = images.made()

      // Back to the first. No timer advanced, no image built: it is already on.
      expect(await service.setPicture(SIG_A)).toBe(true)
      expect(document.body.style.backgroundImage).toBe(first)
      expect(images.made()).toBe(spent)
    } finally {
      images.restore()
    }
  })

  // A BACKDROP DOES NOT ARRIVE IN PIECES.
  //
  // The picture used to reach the screen three times: painted `contain` the
  // moment its bytes resolved, repainted at the chosen zoom once the image had
  // loaded and could be measured, and repainted again — now twice as wide —
  // when the mirrored strip finished encoding. "It shows in place and then it
  // expands to full." Every one of those paints is real, and the two that are
  // not the last one are a picture the participant watches grow into place.
  it('lands already expanded — one paint, never a small one that grows', async () => {
    const store = fakeStore({ resources: { [SIG_A]: new Blob(['picture']) } })
    register(store)

    // jsdom neither loads images nor draws canvases, and this case is entirely
    // about what is true at the moment of the paint — so it supplies both.
    const images = loadableImages()
    const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    const realGetContext = canvas.getContext
    const realToBlob = canvas.toBlob
    const strips: { width: number; height: number; type: string }[] = []
    canvas.getContext = (): unknown => ({
      drawImage: () => {}, save: () => {}, translate: () => {}, scale: () => {}, restore: () => {},
    })
    canvas.toBlob = function (this: HTMLCanvasElement, callback: (blob: Blob) => void, type: string): void {
      strips.push({ width: this.width, height: this.height, type })
      callback(new Blob(['strip']))
    }
    let handles = 0
    URL.createObjectURL = (() => (++handles === 1 ? 'blob:picture' : 'blob:mirror')) as typeof URL.createObjectURL

    try {
      const service = new CanvasBackgroundService()
      // Every paint this service makes, as the body actually wore it.
      const paints: { image: string; size: string }[] = []
      service.addEventListener('change', () => {
        paints.push({ image: document.body.style.backgroundImage, size: document.body.style.backgroundSize })
      })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await service.setPicture(SIG_A)).toBe(true)
      await vi.advanceTimersByTimeAsync(1_000)

      const showing = paints.filter(paint => paint.image.includes('blob:'))
      expect(showing.length).toBeGreaterThan(0)
      // ONE size, and it is the finished one: the strip, at the whole-picture
      // fit. `contain` is what the picture wore while its own dimensions were
      // still unknown, and a lone unmirrored handle is the paint before the
      // strip arrived. Neither may ever reach the screen.
      expect(new Set(showing.map(paint => paint.size)).size).toBe(1)
      expect(showing[0].size).not.toContain('contain')
      expect(showing[0].image).toContain('blob:mirror')

      // AND THE STRIP IS BUILT FOR THE SCREEN. A 1200×800 picture on jsdom's
      // 1024×768 viewport is shown 1152 wide at the whole-picture fit, so the
      // two-panel strip is ~2304 — not the 2400 the file itself would give,
      // and for a photograph off a camera not the 12000 it would have been.
      // WebP, because a paint buffer is not a stored picture.
      expect(strips.length).toBe(1)
      expect(strips[0].width).toBeLessThanOrEqual(1200 * 2)
      expect(strips[0].width).toBe(2 * Math.round(1200 * Math.min(1024 / 1200, 768 / 800)))
      expect(strips[0].type).toBe('image/webp')
    } finally {
      images.restore()
      canvas.getContext = realGetContext
      canvas.toBlob = realToBlob
    }
  })
})
