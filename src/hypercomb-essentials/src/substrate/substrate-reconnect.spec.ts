// substrate-reconnect.spec.ts — the folder re-grant pill.
//
// A linked folder that lost its permission puts ONE actionable pill on the
// command line. Its click must reach requestFolderAccess inside the press:
// the command line activates on mousedown (a user gesture) and the bus is
// synchronous, so the request has to START before the handler first awaits.
// It used to listen for `indicator:click`, which nothing emits, and wore an ×
// that only hid it.
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers
// at load).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const service = {
  warmUp: vi.fn(async () => {}),
  requestFolderAccess: vi.fn(async (_handleId: string): Promise<'granted' | 'denied' | 'prompt'> => 'granted'),
  resolvedSource: null,
}

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => key === '@diamondcoreprocessor.com/SubstrateService' ? service : undefined,
}

const { SubstrateDrone } = await import('./substrate.drone.js')

type Pill = { key: string; dismissable?: boolean; actionable?: boolean }

let pills: Pill[]
let cleared: string[]
let activity: string[]

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const boot = async (): Promise<void> => {
  const drone = new SubstrateDrone()
  await (drone as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
  await settle()
  pills = []
  cleared = []
  activity = []
  EffectBus.on<Pill>('indicator:set', p => pills.push(p))
  EffectBus.on<{ key: string }>('indicator:clear', p => cleared.push(p.key))
  EffectBus.on<{ message: string }>('activity:log', p => activity.push(p.message))
  pills.length = 0
  cleared.length = 0
  activity.length = 0
}

beforeEach(() => {
  EffectBus.clear()
  service.warmUp.mockClear()
  service.requestFolderAccess.mockClear()
  service.requestFolderAccess.mockImplementation(async () => 'granted')
})

describe('substrate reconnect pill', () => {
  it('is producer-owned and actionable — no ×, never persisted', async () => {
    await boot()
    EffectBus.emit('substrate:folder-permission', { handleId: 'h1', permission: 'prompt' })
    expect(pills).toEqual([expect.objectContaining({ key: 'substrate-reconnect', dismissable: false, actionable: true })])
  })

  it('starts the permission request inside the press, then clears itself', async () => {
    await boot()
    EffectBus.emit('substrate:folder-permission', { handleId: 'h1', permission: 'prompt' })
    EffectBus.emit('indicator:activate', { key: 'substrate-reconnect' })
    // No await between the press and the request: the gesture is intact.
    expect(service.requestFolderAccess).toHaveBeenCalledWith('h1')
    await settle()
    expect(cleared).toContain('substrate-reconnect')
    expect(service.warmUp).toHaveBeenCalled()
    expect(activity).toEqual(['substrate folder reconnected'])
  })

  it('keeps the pill when the grant is refused', async () => {
    await boot()
    service.requestFolderAccess.mockImplementation(async () => 'denied')
    EffectBus.emit('substrate:folder-permission', { handleId: 'h1', permission: 'prompt' })
    EffectBus.emit('indicator:activate', { key: 'substrate-reconnect' })
    await settle()
    expect(cleared).not.toContain('substrate-reconnect')
    expect(activity).toEqual(['substrate folder access denied'])
  })

  it('ignores other pills', async () => {
    await boot()
    EffectBus.emit('substrate:folder-permission', { handleId: 'h1', permission: 'prompt' })
    EffectBus.emit('indicator:activate', { key: 'ai-spend' })
    expect(service.requestFolderAccess).not.toHaveBeenCalled()
  })

  it('clears a restored stale copy when the command line asks and nothing is pending', async () => {
    await boot()
    EffectBus.emit('indicator:query', {})
    expect(cleared).toContain('substrate-reconnect')
    expect(pills).toEqual([])
  })

  it('replays the live pill when the command line asks and a re-grant is pending', async () => {
    await boot()
    EffectBus.emit('substrate:folder-permission', { handleId: 'h1', permission: 'prompt' })
    pills.length = 0
    EffectBus.emit('indicator:query', {})
    expect(pills).toEqual([expect.objectContaining({ key: 'substrate-reconnect', actionable: true })])
  })
})
