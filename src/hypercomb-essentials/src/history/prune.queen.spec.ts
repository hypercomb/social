// history/prune.queen.spec.ts — a window opens only from its own door.
//
// `prune` answers on the canvas (the deleted tiles appear where you stand).
// It never raises the history window; `history` is that window's word.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const prune = vi.hoisted(() => ({ active: false, enter: async function (this: { active: boolean }) { this.active = true } }))

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  ;(globalThis as unknown as { get: (k: string) => unknown }).get = (key: string) =>
    key === '@diamondcoreprocessor.com/PruneService' ? prune : undefined
})

vi.mock('./prune.service.js', () => ({ PruneService: class {} }))

const { PruneQueenBee } = await import('./prune.queen.js')

describe('prune', () => {
  it('enters the deleted-tiles layer and opens no history window', async () => {
    const opens: unknown[] = []
    let live = false
    EffectBus.on('history:view-open', p => { if (live) opens.push(p) })
    EffectBus.on('history:view-toggle', p => { if (live) opens.push(p) })
    live = true

    const toasts: { actionEffect?: string }[] = []
    EffectBus.on<{ actionEffect?: string }>('toast:show', t => { if (live) toasts.push(t) })

    await new PruneQueenBee().invoke('my hive')
    expect(prune.active).toBe(true)
    expect(opens).toEqual([])
    // Said in place, with History's door on the toast.
    expect(toasts.map(t => t.actionEffect)).toEqual(['history:view-open'])
  })
})
