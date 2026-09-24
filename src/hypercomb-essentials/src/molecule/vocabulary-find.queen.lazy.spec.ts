// molecule/vocabulary-find.queen.lazy.spec.ts
//
// THE WINDOW ARRIVES WITH THE ASK (atomic-modules-plan.md, "adopt the proper
// load"): the queen adds the lookup's tag at boot without loading the view,
// and the first `vocabulary:find` defines it — once.

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

vi.mock('./vocabulary-find.view.js', async importOriginal => {
  state.loads++
  return importOriginal()
})

import { EffectBus } from '@hypercomb/core'
import { VOCABULARY_FIND } from './vocabulary-words.js'
import './vocabulary-find.queen.js'

const TAG = 'hc-vocabulary-find'

describe('/find-word — the lookup loads when it is asked for', () => {
  it('adds its tag at boot and loads nothing', () => {
    expect(state.added).toContainEqual(expect.objectContaining({ name: TAG, element: TAG, order: 141 }))
    expect(customElements.get(TAG)).toBeUndefined()
    expect(state.loads).toBe(0)
  })

  it('the ask defines the element once, and the one in the page opens', async () => {
    const element = document.body.appendChild(document.createElement(TAG)) as HTMLElement & { open$?: boolean }
    const define = vi.spyOn(customElements, 'define')
    const emit = vi.spyOn(EffectBus, 'emit')
    try {
      // An empty word opens the window without asking any host.
      EffectBus.emit(VOCABULARY_FIND, { word: '', at: Date.now() })
      EffectBus.emit(VOCABULARY_FIND, { word: '', at: Date.now() })
      await vi.waitFor(() => expect(element.open$).toBe(true))
      // A fast load needs no second ask: the upgrade's replay opened it.
      expect(emit.mock.calls.filter(([effect]) => effect === VOCABULARY_FIND)).toHaveLength(2)

      EffectBus.emit(VOCABULARY_FIND, { word: '', at: Date.now() })
      await Promise.resolve()
      expect(define.mock.calls.filter(([tag]) => tag === TAG)).toHaveLength(1)
      expect(state.loads).toBe(1)
    } finally {
      define.mockRestore()
      emit.mockRestore()
      element.remove()
    }
  })
})
