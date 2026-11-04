// peer-models.resubscribe.spec.ts - a burst of room / secret / zone moves
// leaves ONE set of relay subscriptions open, never an orphan per move.
//
// #resubscribe closed three subs and re-opened them with awaits in between and
// no generation guard, so two overlapping calls each opened their own three and
// the older set was never closed.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
window.ioc ??= {
  register: (key: string, value: unknown) => { services.set(key, value) },
  get: <T>(key: string) => services.get(key) as T | undefined,
  whenReady: () => {}, list: () => [...services.keys()],
} as typeof window.ioc

const PUBKEY = 'b'.repeat(64)
let open = 0
const room = { value: 'room-a' }

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }

let Drone: new () => unknown
let drone: { heartbeat: () => Promise<void>; markDisposed: () => void }

beforeAll(async () => {
  services.set('@diamondcoreprocessor.com/NostrMeshDrone', {
    publish: async () => true,
    subscribe: () => { open++; let live = true; return { close: () => { if (live) { live = false; open-- } } } },
    swarmHost: () => 'host.test',
  })
  services.set('@diamondcoreprocessor.com/NostrSigner', { getPublicKeyHex: async () => PUBKEY })
  // a slow signature: every await in #resubscribe yields, so calls overlap
  services.set('@hypercomb/SignatureStore', { signText: async (s: string) => { await new Promise(r => setTimeout(r, 1)); return `sig:${s}` } })
  services.set('@hypercomb.social/RoomStore', room)
  services.set('@hypercomb.social/SecretStore', { value: 'secret' })
  const mod = await import('./peer-models.drone.js')
  Drone = mod.PeerModelsDrone
})

beforeEach(() => { drone = new Drone() as typeof drone })

afterEach(() => { drone.markDisposed() })

describe('resubscribing the peer-model channels', () => {
  it('a burst of room, secret and zone moves leaves exactly three subscriptions open', async () => {
    await drone.heartbeat()
    await settle()
    expect(open).toBe(3)

    room.value = 'room-b'
    EffectBus.emit('mesh:room', {})
    EffectBus.emit('mesh:secret', {})
    EffectBus.emit('mesh:zone', {})
    await settle()
    expect(open).toBe(3)
  })

  it('stops after dispose: nothing re-opens behind a closed drone', async () => {
    await drone.heartbeat()
    await settle()
    expect(open).toBe(3)
    drone.markDisposed()
    EffectBus.emit('mesh:room', {})
    await settle()
    expect(open).toBe(0)
  })
})
