// effect-bus.spec.ts - replay is for state; a one-shot is for a press.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from './effect-bus.js'

beforeEach(() => EffectBus.clear())

describe('last-value replay', () => {
  it('hands a state effect to a late subscriber', () => {
    EffectBus.emit('spec:state', { n: 1 })
    const seen: unknown[] = []
    EffectBus.on('spec:state', p => seen.push(p))
    expect(seen).toEqual([{ n: 1 }])
  })

  it('never hands a transient effect to a late subscriber', () => {
    EffectBus.emitTransient('spec:command', { cmd: 'history.undo' })
    const seen: unknown[] = []
    EffectBus.on('spec:command', p => seen.push(p))
    expect(seen).toEqual([])
  })

  it('still delivers a transient effect to a subscriber that is already there', () => {
    const seen: unknown[] = []
    EffectBus.on('spec:command', p => seen.push(p))
    EffectBus.emitTransient('spec:command', { cmd: 'a' })
    expect(seen).toEqual([{ cmd: 'a' }])
  })
})

describe('once', () => {
  it('fires once for a live emit and then lets go', () => {
    const seen: unknown[] = []
    EffectBus.once('spec:once', p => seen.push(p))
    EffectBus.emit('spec:once', 1)
    EffectBus.emit('spec:once', 2)
    expect(seen).toEqual([1])
    expect(EffectBus.listens('spec:once')).toBe(false)
  })

  it('does not throw when the replay is delivered before on() returns, and lets go', () => {
    EffectBus.emit('spec:once', 'old')
    const seen: unknown[] = []
    expect(() => EffectBus.once('spec:once', p => seen.push(p))).not.toThrow()
    expect(seen).toEqual(['old'])
    expect(EffectBus.listens('spec:once')).toBe(false)
    EffectBus.emit('spec:once', 'new')
    expect(seen).toEqual(['old'])
  })

  it('can be cancelled before it fires', () => {
    const seen: unknown[] = []
    const off = EffectBus.once('spec:once', p => seen.push(p))
    off()
    EffectBus.emit('spec:once', 1)
    expect(seen).toEqual([])
  })
})
