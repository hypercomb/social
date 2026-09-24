// presentation/tiles/template-author.lazy.spec.ts
//
// THE TARGETS WINDOW ARRIVES WITH THE ASK (atomic-modules-plan.md, "adopt the
// proper load"): the template-author bee adds the targets window's tag at boot
// without loading the view, and the first `targets:open` defines it — once.
// A close, or a designer that goes away while it loads, loads nothing / opens
// nothing late.

import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const added: { name?: string; element?: string; order?: number }[] = []
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: (key: string, callback: (value: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') callback({ add: (surface: never) => added.push(surface) })
    },
    onRegister: () => () => { /* noop */ },
  }
  return { added, loads: 0 }
})

vi.mock('./layout-targets.view.js', async importOriginal => {
  state.loads++
  return importOriginal()
})

import { EffectBus } from '@hypercomb/core'
import { TARGETS_OPEN, TEMPLATE_VIEW_STATE } from './template-author-effects.js'
import './template-author.drone.js'

const TAG = 'hc-layout-targets'

describe('the targets window loads when it is asked for', () => {
  it('adds its tag at boot and loads nothing', () => {
    expect(state.added).toContainEqual(expect.objectContaining({ name: TAG, element: TAG, order: 138 }))
    expect(customElements.get(TAG)).toBeUndefined()
    expect(state.loads).toBe(0)
  })

  it('a close loads nothing', async () => {
    EffectBus.emit(TARGETS_OPEN, { open: false, at: Date.now() })
    await Promise.resolve()
    expect(state.loads).toBe(0)
  })

  it('an open defines the element once; a designer gone mid-load opens nothing late', async () => {
    const define = vi.spyOn(customElements, 'define')
    const emit = vi.spyOn(EffectBus, 'emit')
    const asked = Date.now()
    try {
      EffectBus.emit(TARGETS_OPEN, { open: true, at: asked })
      EffectBus.emit(TARGETS_OPEN, { open: true, at: asked })
      // The designer closes while the view is still loading, and the load
      // itself outlives the stamp: the ask is withdrawn, not re-sent.
      EffectBus.emit(TEMPLATE_VIEW_STATE, { open: false })
      const now = vi.spyOn(Date, 'now').mockReturnValue(asked + 11_000)
      try {
        await vi.waitFor(() => expect(customElements.get(TAG)).toBeDefined())
        await new Promise(resolve => setTimeout(resolve, 0))
      } finally {
        now.mockRestore()
      }
      expect(emit.mock.calls.filter(([effect]) => effect === TARGETS_OPEN)).toHaveLength(2)

      EffectBus.emit(TARGETS_OPEN, { open: true, at: Date.now() })
      await Promise.resolve()
      expect(define.mock.calls.filter(([tag]) => tag === TAG)).toHaveLength(1)
      expect(state.loads).toBe(1)
    } finally {
      define.mockRestore()
      emit.mockRestore()
    }
  })
})
