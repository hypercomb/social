// commands/toast.drone.spec.ts — what the toasts said stays readable after they go.

import { describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => {
  const held = new Map<string, unknown>()
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: (k: string, v: unknown) => { held.set(k, v) }, get: (k: string) => held.get(k), whenReady: () => {} }
  return held
})

import { EffectBus } from '@hypercomb/core'
import type { ToastDrone } from './toast.drone.js'
import './toast.drone.js'

const drone = (): ToastDrone => registry.get('@diamondcoreprocessor.com/ToastDrone') as ToastDrone

describe('the toast history', () => {
  it('keeps every message, newest first, after the toast has gone', () => {
    EffectBus.emit('toast:show', { type: 'info', message: 'one', duration: 1 })
    EffectBus.emit('toast:show', { type: 'success', title: 'Done', message: 'two', duration: 1 })
    expect(drone().history.map(r => r.message)).toEqual(['two', 'one'])
    expect(drone().history[0]).toMatchObject({ type: 'success', title: 'Done' })
  })

  it('is capped, and can be cleared', () => {
    drone().clearHistory()
    for (let i = 0; i < 230; i++) EffectBus.emit('toast:show', { type: 'tip', message: `m${i}`, duration: 1 })
    expect(drone().history).toHaveLength(200)
    expect(drone().history[0]!.message).toBe('m229')
    drone().clearHistory()
    expect(drone().history).toHaveLength(0)
  })
})
