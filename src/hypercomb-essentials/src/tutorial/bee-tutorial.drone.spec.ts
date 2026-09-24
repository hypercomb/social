// The tour's overlay arrives with the first tour, not at boot
// (atomic-modules-plan.md, "adopt the proper load"). The bee adds the surface
// at boot without the view; `tutorial:start` loads it, defines the element the
// shell already made (it upgrades in place, announces itself, and the bee
// registers it), and runs ONE course however many starts arrive while it loads.

import { describe, expect, it, vi } from 'vitest'

const TAG = 'hc-bee-tutorial'
const OVERLAY_KEY = '@diamondcoreprocessor.com/BeeTutorialOverlay'

const state = vi.hoisted(() => ({
  services: new Map<string, unknown>(),
  ready: new Map<string, ((value: unknown) => void)[]>(),
  added: [] as unknown[],
  failNextLoad: false,
  activated: 0,
  deactivated: 0,
}))

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => state.services.get(key),
    register: (key: string, value: unknown) => {
      if (state.services.has(key)) return
      state.services.set(key, value)
      for (const callback of state.ready.get(key)?.splice(0) ?? []) callback(value)
    },
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') { callback({ add: (s: unknown) => state.added.push(s) }); return }
      if (state.services.has(key)) { callback(state.services.get(key)); return }
      state.ready.set(key, [...(state.ready.get(key) ?? []), callback])
    },
  }
})

// A stand-in overlay: it announces itself on connect, as the real one does, and
// every course it is handed is skipped at the welcome bubble.
vi.mock('./tutorial-overlay.view.js', async () => {
  if (state.failNextLoad) { state.failNextLoad = false; throw new Error('the atom did not arrive') }
  let mounted: HTMLElement | null = null
  const waiters: ((overlay: HTMLElement) => void)[] = []
  class Overlay extends HTMLElement {
    onSkipRequested: (() => void) | null = null
    connectedCallback(): void {
      if (mounted) return
      mounted = this
      for (const waiter of waiters.splice(0)) waiter(this)
    }
    activate(): void { state.activated++ }
    deactivate(): void { state.deactivated++ }
    async say(): Promise<string> { return 'skip' }
    async flyTo(): Promise<void> {}
    async flyOff(): Promise<void> {}
    async waggle(): Promise<void> {}
    async ghostClick(): Promise<void> {}
    hideBubble(): void {}
    highlight(): void {}
    dismiss(): void {}
  }
  return {
    BeeTutorialOverlayElement: Overlay,
    onOverlayMounted: (callback: (overlay: HTMLElement) => void): void => {
      if (mounted) callback(mounted)
      else waiters.push(callback)
    },
  }
})

import { EffectBus } from '@hypercomb/core'

const define = vi.spyOn(customElements, 'define')
await import('./bee-tutorial.drone.js')

const defines = (): number => define.mock.calls.filter(([name]) => name === TAG).length
const start = (): void => { EffectBus.emit('tutorial:start', { level: 'starter' }) }
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }

// What the shell's surface host does: create the tag, defined or not.
document.body.appendChild(document.createElement(TAG))

describe('bee tutorial — the overlay arrives with the first tour', () => {
  it('adds the surface at boot and leaves the element undefined', () => {
    expect(state.added).toEqual([{ name: TAG, owner: '@diamondcoreprocessor.com/BeeTutorialDrone', element: TAG, order: 900 }])
    expect(customElements.get(TAG)).toBeUndefined()
    expect(state.services.has(OVERLAY_KEY)).toBe(false)
  })

  it('starts nothing when the overlay cannot load, says so, and loads again on the next start', async () => {
    const toasts: { type?: string }[] = []
    const off = EffectBus.on<{ type?: string }>('toast:show', toast => { toasts.push(toast) })
    toasts.length = 0 // the bus replays whatever was shown last
    state.failNextLoad = true
    start()
    await vi.waitFor(() => expect(toasts.some(toast => toast.type === 'warning')).toBe(true))
    off()
    await settle()
    expect(state.activated).toBe(0)
    expect(customElements.get(TAG)).toBeUndefined()
  })

  it('defines the element once and runs one course for two starts in a row', async () => {
    start()
    start()
    await vi.waitFor(() => expect(state.deactivated).toBe(1))
    await settle()
    expect(defines()).toBe(1)
    expect(state.services.get(OVERLAY_KEY)).toBeInstanceOf(customElements.get(TAG)!)
    expect(state.activated).toBe(1)
  })

  it('a later start defines nothing again', async () => {
    start()
    await vi.waitFor(() => expect(state.deactivated).toBe(2))
    expect(defines()).toBe(1)
  })

  it('a stop before the overlay is in hand means the tour never starts, and releases the next start', async () => {
    start()
    EffectBus.emit('tutorial:stop', {})
    await settle()
    expect(state.activated).toBe(2)
    start()
    await vi.waitFor(() => expect(state.deactivated).toBe(3))
  })

  it('a lesson whose requires() throws costs one start, never the next', async () => {
    const lessons = state.services.get('@diamondcoreprocessor.com/TutorialLessonRegistry') as {
      register(lesson: unknown): void
      unregister(id: string): void
    }
    lessons.register({
      id: 'throws-on-ask', level: 'expert', order: 1, pheromones: [], title: 'throws',
      requires: () => { throw new Error('a third-party lesson broke') },
      run: async () => {},
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    EffectBus.emit('tutorial:start', { level: 'expert' })
    await settle()
    expect(warn).toHaveBeenCalledWith('[tutorial] lessons unavailable', expect.any(Error))
    warn.mockRestore()
    lessons.unregister('throws-on-ask')
    start()
    await vi.waitFor(() => expect(state.deactivated).toBe(4))
  })
})
