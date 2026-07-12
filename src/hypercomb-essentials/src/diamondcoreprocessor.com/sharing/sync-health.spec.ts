// sync-health.spec.ts — the backup-state pill's load-bearing behaviors.
//
// The producer's semantics (host-sync drain) shape every case: a normal
// successful drain emits ONLY backed-up, so the steady state must stay
// silent; 'syncing' means a drain ended still owing receipts (stuck, not
// progress); recovery lines fire only when a stuck/refused episode closes.
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers
// at load). i18n is absent → labels assert the fallback sentences.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
}

const { SyncHealthDrone } = await import('./sync-health.drone.js')

type Pill = { key: string; icon: string; label: string; dismissable: boolean }

let drone: InstanceType<typeof SyncHealthDrone>
let pills: Pill[]
let clears: string[]
let activity: string[]

const state = (host: string, status: string, pending: number): void =>
  EffectBus.emit('sync:state', { host, status, pending })

const receipt = (): void =>
  EffectBus.emit('host:receipt', { sig: 'a'.repeat(64) })

const boot = async (): Promise<void> => {
  drone = new SyncHealthDrone()
  await (drone as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
  pills = []
  clears = []
  activity = []
  EffectBus.on<Pill>('indicator:set', p => pills.push(p))
  EffectBus.on<{ key: string }>('indicator:clear', p => clears.push(p.key))
  EffectBus.on<{ message: string }>('activity:log', p => activity.push(p.message))
}

beforeEach(async () => {
  localStorage.clear()
  EffectBus.clear()
  await boot()
})

afterEach(() => drone.markDisposed())

describe('sync-health pill', () => {
  it('backed-up steady state is silence — no pill, no activity line', () => {
    state('jwize.com', 'backed-up', 0)
    state('jwize.com', 'backed-up', 0)
    expect(pills).toHaveLength(0)
    expect(activity).toHaveLength(0)
  })

  it('a stuck drain pills with the count and host named', () => {
    state('jwize.com', 'syncing', 7)
    expect(pills).toHaveLength(1)
    expect(pills[0]).toMatchObject({ key: 'sync:jwize.com', icon: 'cloud_sync', dismissable: true })
    expect(pills[0].label).toBe('7 changes waiting to back up to jwize.com')
  })

  it('host:receipt ticks a stuck pill down live', () => {
    state('jwize.com', 'syncing', 3)
    receipt()
    receipt()
    expect(pills.at(-1)!.label).toBe('1 changes waiting to back up to jwize.com')
  })

  it('unauthorized pills with the rejected-device sentence', () => {
    state('jwize.com', 'unauthorized', 12)
    expect(pills.at(-1)).toMatchObject({ key: 'sync:jwize.com', icon: 'sync_problem' })
    expect(pills.at(-1)!.label).toBe("jwize.com rejected this device — your changes aren't backing up yet")
  })

  it('recovery from a stuck episode clears the pill and logs backed-up', () => {
    state('jwize.com', 'syncing', 4)
    state('jwize.com', 'backed-up', 0)
    expect(clears).toContain('sync:jwize.com')
    expect(activity.at(-1)).toBe('backed up to jwize.com')
  })

  it('first-ever backed-up logs nothing — only a closing episode speaks', () => {
    state('jwize.com', 'backed-up', 0)
    expect(activity).toHaveLength(0)
  })

  it('dismissal holds for the episode; a new episode pills again', () => {
    state('jwize.com', 'syncing', 5)
    expect(pills).toHaveLength(1)
    EffectBus.emit('indicator:dismiss', { key: 'sync:jwize.com' })
    state('jwize.com', 'syncing', 4)   // same episode — stays dismissed
    receipt()                          // countdown also respects dismissal
    expect(pills).toHaveLength(1)
    state('jwize.com', 'backed-up', 0) // episode closes
    state('jwize.com', 'syncing', 2)   // new episode
    expect(pills).toHaveLength(2)
  })

  it('duplicate states emit nothing — transitions only', () => {
    state('jwize.com', 'syncing', 5)
    state('jwize.com', 'syncing', 5)
    expect(pills).toHaveLength(1)
  })

  it('evicts sync pills persisted by a previous session at boot', async () => {
    localStorage.setItem('hc:indicators', JSON.stringify([
      { key: 'sync:jwize.com', icon: 'cloud_sync', label: 'stale', dismissable: true },
      { key: 'dashboard', icon: 'dashboard', label: 'not ours', dismissable: true },
    ]))
    const evicted: string[] = []
    EffectBus.on<{ key: string }>('indicator:clear', p => evicted.push(p.key))
    const fresh = new SyncHealthDrone()
    await (fresh as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
    expect(evicted).toContain('sync:jwize.com')
    expect(evicted).not.toContain('dashboard')
    fresh.markDisposed()
  })
})
