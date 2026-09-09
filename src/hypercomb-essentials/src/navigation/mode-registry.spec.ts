import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { ModeRegistry as ModeRegistryType } from './mode-registry.service.js'

;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => undefined }
const { ModeRegistry } = await import('./mode-registry.service.js')

let modes: ModeRegistryType
let emitted: ReturnType<typeof vi.spyOn>
const states = (name: string): boolean[] => emitted.mock.calls
  .filter(([event]) => event === name)
  .map(([, payload]) => (payload as { active: boolean }).active)

beforeEach(() => {
  vi.restoreAllMocks()
  EffectBus.clear()
  modes = new ModeRegistry()
  emitted = vi.spyOn(EffectBus, 'emit')
})

describe('view shell reservations', () => {
  it('keeps the canvas covered while switching square page controls on and off', () => {
    modes.enter('view:keeps-shell', 'square')
    modes.enter('view:active', 'square')
    expect(states('view:shell-hidden')).toEqual([false])
    expect(states('view:controls-hidden')).toEqual([false])

    modes.exit('view:keeps-shell', 'square')
    expect(states('view:shell-hidden')).toEqual([false, true])
    expect(states('view:controls-hidden')).toEqual([false, true])
    expect(modes.isActive('view:active')).toBe(true)

    modes.enter('view:keeps-shell', 'square')
    expect(states('view:shell-hidden')).toEqual([false, true, false])
    expect(states('view:active')).toEqual([true])
  })

  it('hides retained shell controls under a second takeover and restores them on close', () => {
    modes.enter('view:keeps-shell', 'square')
    modes.enter('view:active', 'square')
    modes.enter('view:active', 'photo')
    expect(states('view:shell-hidden')).toEqual([false, true])
    expect(states('view:controls-hidden')).toEqual([false, true])

    modes.exit('view:active', 'photo')
    expect(states('view:shell-hidden')).toEqual([false, true, false])
    expect(states('view:controls-hidden')).toEqual([false, true, false])
    expect(states('view:active')).toEqual([true])
  })

  it('retains only the bar for a writing desk over the square page', () => {
    modes.enter('view:keeps-shell', 'square')
    modes.enter('view:active', 'square')
    modes.enter('view:keeps-controls', 'notes')
    modes.enter('view:active', 'notes')
    expect(states('view:shell-hidden')).toEqual([false, true])
    expect(states('view:controls-hidden')).toEqual([false])

    modes.releaseOwner('notes')
    expect(states('view:shell-hidden')).toEqual([false, true, false])
    expect(modes.ownersOf('view:active')).toEqual(['square'])
  })

  it('does not let an inactive owner grant shell space to another view', () => {
    modes.enter('view:keeps-shell', 'square')
    modes.enter('view:active', 'photo')
    expect(states('view:shell-hidden')).toEqual([false, true])
    expect(states('view:controls-hidden')).toEqual([false, true])
  })

  it('releases every reservation on teardown and leaves later takeovers independent', () => {
    modes.enter('view:keeps-shell', 'square')
    modes.enter('view:active', 'square')
    modes.releaseOwner('square')
    expect(modes.isActive('view:active')).toBe(false)
    expect(modes.isActive('view:keeps-shell')).toBe(false)
    modes.enter('view:active', 'photo')
    expect(states('view:shell-hidden')).toEqual([false, true])
    modes.releaseOwner('photo')
    expect(states('view:shell-hidden')).toEqual([false, true, false])
    expect(states('view:controls-hidden')).toEqual([false, true, false])
  })

  it('keeps repeated claims and unrelated modes silent', () => {
    modes.enter('view:keeps-shell', 'square')
    modes.enter('view:active', 'square')
    modes.enter('view:keeps-shell', 'square')
    modes.enter('view:active', 'square')
    modes.exit('view:active', 'missing')
    modes.enter('selection:active', 'selection')
    modes.exit('selection:active', 'selection')
    expect(states('view:shell-hidden')).toEqual([false])
    expect(states('view:controls-hidden')).toEqual([false])
    expect(states('view:active')).toEqual([true])
  })
})
