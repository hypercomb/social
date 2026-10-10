// sharing/follow.queen.spec.ts — follow offers the swarm's own hosts and
// follows any domain, through the hosts window's effects.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { EffectBus } from '@hypercomb/core'
import { FollowQueenBee } from './follow.queen.js'
import { nameService } from './names.service.js'

const key = (n: number): string => n.toString(16).padStart(64, '0')

describe('follow', () => {
  it('offers the hosts participants in the swarm advertise, minus the ones you follow', () => {
    nameService.hint(key(1), 'alice.example.org')
    nameService.hint(key(2), 'bob.example.net')
    const follow = new FollowQueenBee()
    EffectBus.emit('hosts:render', { zones: ['bob.example.net'] })
    expect(follow.slashComplete('')).toEqual(['alice.example.org'])
    expect(follow.slashComplete('al')).toEqual(['alice.example.org'])
    expect(follow.slashComplete('off ')).toEqual(['off bob.example.net'])
  })

  it('follows any domain you type, and stops following one you follow', async () => {
    const follow = new FollowQueenBee()
    EffectBus.emit('hosts:render', { zones: ['bob.example.net'] })
    const added = vi.fn()
    const removed = vi.fn()
    const offAdd = EffectBus.on('hosts:add', added)
    const offRemove = EffectBus.on('hosts:remove', removed)
    added.mockClear()
    removed.mockClear()
    await (follow as unknown as { execute(args: string): Promise<void> }).execute('https://Someones-Domain.com/')
    expect(added).toHaveBeenLastCalledWith({ zone: 'someones-domain.com' })
    await (follow as unknown as { execute(args: string): Promise<void> }).execute('off bob.example.net')
    expect(removed).toHaveBeenLastCalledWith({ zone: 'bob.example.net' })
    offAdd()
    offRemove()
  })
})
