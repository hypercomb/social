import { describe, expect, it, vi } from 'vitest'
import { LazyOverlay, type OverlayLike } from './lazy-overlay.js'

class Fake implements OverlayLike {
  mounted = false
  designer = false
  constructor(readonly onClose: () => void) {}
  mount(): void { this.mounted = true }
  unmount(): void { this.mounted = false }
  isMounted(): boolean { return this.mounted }
  showDesigner(): void { this.designer = true }
}

/** A loader the test releases by hand. */
const gate = () => {
  let release!: () => void
  let fail!: (e: unknown) => void
  const loads = vi.fn(() => new Promise<(onClose: () => void) => Fake>((resolve, reject) => {
    release = () => resolve(onClose => new Fake(onClose))
    fail = reject
  }))
  return { loads, release: () => release(), fail: (e: unknown) => fail(e) }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('LazyOverlay — the game loads when it opens', () => {
  it('counts as active while loading, then mounts', async () => {
    const g = gate()
    const change = vi.fn()
    const lazy = new LazyOverlay(g.loads, () => {}, change)
    expect(g.loads).not.toHaveBeenCalled()
    lazy.open()
    expect(lazy.isActive()).toBe(true)
    expect(lazy.current).toBeNull()
    g.release(); await tick()
    expect(lazy.current?.isMounted()).toBe(true)
    expect(change).toHaveBeenCalledTimes(1)
  })

  it('a close during the load cancels it — the game never mounts', async () => {
    const g = gate()
    const lazy = new LazyOverlay(g.loads, () => {}, () => {})
    lazy.open()
    expect(lazy.close()).toBe(true)
    expect(lazy.isActive()).toBe(false)
    g.release(); await tick()
    expect(lazy.current).toBeNull()
    expect(lazy.close()).toBe(false)
  })

  it('work queued behind a load runs on the mounted overlay', async () => {
    const g = gate()
    const lazy = new LazyOverlay(g.loads, () => {}, () => {})
    lazy.open()
    lazy.open(o => o.showDesigner())
    g.release(); await tick()
    expect(lazy.current?.designer).toBe(true)
    expect(g.loads).toHaveBeenCalledTimes(1)
  })

  it('prefetch loads once and a later open reuses it', async () => {
    const g = gate()
    const lazy = new LazyOverlay(g.loads, () => {}, () => {})
    const warm = lazy.prefetch()
    g.release(); await warm
    lazy.open(); await tick()
    expect(lazy.current?.isMounted()).toBe(true)
    expect(g.loads).toHaveBeenCalledTimes(1)
  })

  it('a failed load is forgotten, so the next open tries again', async () => {
    const g = gate()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lazy = new LazyOverlay(g.loads, () => {}, () => {})
    lazy.open()
    g.fail(new Error('offline')); await tick()
    expect(lazy.isActive()).toBe(false)
    lazy.open()
    g.release(); await tick()
    expect(lazy.current?.isMounted()).toBe(true)
    expect(g.loads).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
