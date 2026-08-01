// sync-health.spec.ts — the backup-state reporter's load-bearing behaviors.
//
// The producer's semantics (host-sync drain) shape every case: a normal
// successful drain emits ONLY backed-up, so the steady state must stay
// silent; 'syncing' means a drain ended still owing receipts (stuck, not
// progress); recovery lines fire only when a stuck/refused episode closes.
//
// The indicator PILL is retired — this drone must never park a glyph in the
// command line again. It reports through 'sync:health' and the recovery
// activity line only, and sweeps pill keys older builds persisted.
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers
// at load).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
}

const { SyncHealthDrone } = await import('./sync-health.drone.js')

type Pill = { key: string }
type Health = { host?: string; target?: string; status: string; pending?: number }

let drone: InstanceType<typeof SyncHealthDrone>
let pills: Pill[]
let clears: string[]
let activity: string[]
let health: Health[]

const state = (host: string, status: string, pending: number): void =>
  EffectBus.emit('sync:state', { host, status, pending })

const folderState = (status: string, detail: Record<string, unknown> = {}): void =>
  EffectBus.emit('folder-sync:state', { status, ...detail })

const boot = async (): Promise<void> => {
  drone = new SyncHealthDrone()
  await (drone as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
  pills = []
  clears = []
  activity = []
  health = []
  EffectBus.on<Pill>('indicator:set', p => pills.push(p))
  EffectBus.on<{ key: string }>('indicator:clear', p => clears.push(p.key))
  EffectBus.on<{ message: string }>('activity:log', p => activity.push(p.message))
  EffectBus.on<Health>('sync:health', p => health.push(p))
}

beforeEach(async () => {
  localStorage.clear()
  EffectBus.clear()
  await boot()
})

afterEach(() => drone.markDisposed())

describe('sync-health', () => {
  it('backed-up steady state is silence — no activity line', () => {
    state('jwize.com', 'backed-up', 0)
    state('jwize.com', 'backed-up', 0)
    expect(activity).toHaveLength(0)
  })

  it('never sets an indicator pill, in any state', () => {
    state('jwize.com', 'syncing', 7)
    state('jwize.com', 'unauthorized', 12)
    folderState('unconfigured')
    folderState('needs-permission', { folder: 'Private backup' })
    folderState('incomplete', { folder: 'USB', missingReferences: 3 })
    expect(pills).toHaveLength(0)
  })

  it('a stuck drain reports through sync:health with the count and host', () => {
    state('jwize.com', 'syncing', 7)
    expect(health.at(-1)).toMatchObject({ host: 'jwize.com', status: 'syncing', pending: 7 })
  })

  it('recovery from a stuck episode logs backed-up', () => {
    state('jwize.com', 'syncing', 4)
    state('jwize.com', 'backed-up', 0)
    expect(activity.at(-1)).toBe('backed up to jwize.com')
  })

  it('first-ever backed-up logs nothing — only a closing episode speaks', () => {
    state('jwize.com', 'backed-up', 0)
    expect(activity).toHaveLength(0)
  })

  it('duplicate states emit nothing — transitions only', () => {
    state('jwize.com', 'syncing', 5)
    const seen = health.length
    state('jwize.com', 'syncing', 5)
    expect(health).toHaveLength(seen)
  })

  it('folder backup reports its status and logs only on recovery', () => {
    folderState('needs-permission', { folder: 'USB' })
    expect(health.at(-1)).toMatchObject({ target: 'folder', status: 'needs-permission' })
    expect(activity).toHaveLength(0)
    folderState('backed-up', { folder: 'USB' })
    expect(activity.at(-1)).toContain('folder backup recovered')
  })

  it('evicts sync pills persisted by a previous build at boot', async () => {
    localStorage.setItem('hc:indicators', JSON.stringify([
      { key: 'sync:jwize.com', icon: 'cloud_sync', label: 'stale', dismissable: true },
      { key: 'folder-sync', icon: 'folder_off', label: 'stale folder', dismissable: true },
      { key: 'notes', icon: 'sticky_note_2', label: 'not ours', dismissable: true },
    ]))
    const evicted: string[] = []
    EffectBus.on<{ key: string }>('indicator:clear', p => evicted.push(p.key))
    const fresh = new SyncHealthDrone()
    await (fresh as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
    expect(evicted).toContain('sync:jwize.com')
    expect(evicted).toContain('folder-sync')
    expect(evicted).not.toContain('notes')
    fresh.markDisposed()
  })
})
