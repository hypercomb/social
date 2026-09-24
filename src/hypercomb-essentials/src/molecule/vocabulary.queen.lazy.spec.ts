// molecule/vocabulary.queen.lazy.spec.ts
//
// THE WINDOW ARRIVES WITH THE ASK (atomic-modules-plan.md, "adopt the proper
// load"): the queen adds the vocabulary window's tag at boot without loading
// the view, and the first `vocabulary:open` defines it — once, and even when
// the first load outlives the window's stamp.

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

vi.mock('./vocabulary.view.js', async importOriginal => {
  state.loads++
  return importOriginal()
})

import { EffectBus } from '@hypercomb/core'
import { OPEN_STAMP_MS, VOCABULARY_OPEN } from './vocabulary-words.js'
import './vocabulary.queen.js'

const TAG = 'hc-vocabulary'

describe('/vocabulary — the window loads when it is asked for', () => {
  it('adds its tag at boot and loads nothing', () => {
    expect(state.added).toContainEqual(expect.objectContaining({ name: TAG, element: TAG, order: 140 }))
    expect(customElements.get(TAG)).toBeUndefined()
    expect(state.loads).toBe(0)
  })

  it('a first load slower than the stamp still opens the window, aimed, and defines it once', async () => {
    const element = document.body.appendChild(document.createElement(TAG)) as HTMLElement & { open$?: boolean }
    const define = vi.spyOn(customElements, 'define')
    const emit = vi.spyOn(EffectBus, 'emit')
    const asked = Date.now()
    try {
      EffectBus.emit(VOCABULARY_OPEN, { intent: 'publish', at: asked })
      // The load finishes after the ask has aged out of the window's stamp,
      // so the upgrade's replay is dropped — the queen asks again.
      const now = vi.spyOn(Date, 'now').mockReturnValue(asked + OPEN_STAMP_MS + 1_000)
      try {
        await vi.waitFor(() => expect(element.open$).toBe(true))
      } finally {
        now.mockRestore()
      }
      const asks = emit.mock.calls.filter(([effect]) => effect === VOCABULARY_OPEN).map(([, payload]) => payload)
      expect(asks).toHaveLength(2)
      // Still only an intent the queen offers — nothing else rides along.
      expect(Object.keys(asks[1] as object).sort()).toEqual(['at', 'intent'])
      expect(asks[1]).toMatchObject({ intent: 'publish' })

      EffectBus.emit(VOCABULARY_OPEN, { intent: '', at: Date.now() })
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
