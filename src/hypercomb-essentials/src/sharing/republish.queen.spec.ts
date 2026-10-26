import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { EffectBus } from '@hypercomb/core'
import { RepublishQueenBee } from './republish.queen.js'

describe('republish', () => {
  it('asks the Publish drone to republish what has drifted, and nothing else', () => {
    const seen = vi.fn()
    EffectBus.on('publish:run-drifted', seen)
    new RepublishQueenBee().invoke('')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('is the participant\'s to say: a machine is refused', () => {
    expect(new RepublishQueenBee().machine.refuse()).toMatch(/participant/)
  })
})
