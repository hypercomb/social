// sharing/room-scoped-channels.spec.ts — EVERY ROOM ADDRESS NAMES ITS HOST.
//
// jwize, 2026-10-12: a room is its host + room + secret (core roomPreimage).
// The swarm's own addresses moved with it; so must every other address
// derived from the room — or 'garden'/'rose' at hypercomb.com and
// 'garden'/'rose' at another host would still share a client roster and a
// model-lending channel while being two rooms. Pinned:
//   1. client-presence's roster channel is `hc:clients \0 room \0 secret \0
//      host`, and moves with the host. No host named: no channel at all —
//      there is no default host (2026-10-11).
//   2. peer-models' offer / request / reply channels are `<label>:<pubkey> \0
//      room \0 secret \0 host`, and a new meeting point (`mesh:zone`)
//      resubscribes them there.

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { EffectBus, roomPreimage } from '@hypercomb/core'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'b'.repeat(64)

const point = { host: 'hypercomb.com' }
const subscribed: string[] = []
const mesh = {
  publish: vi.fn(async () => true),
  subscribe: vi.fn((sig: string) => { subscribed.push(sig); return { close: () => undefined } }),
  swarmHost: () => point.host,
}
const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@hypercomb.social/RoomStore': { value: 'garden' },
  '@hypercomb.social/SecretStore': { value: 'rose' },
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
  whenReady: () => undefined,
}

const { ClientPresenceDrone } = await import('./client-presence.drone.js')
await import('./peer-models.drone.js')

describe('client-presence: the roster channel is the room at its point', () => {
  it('names the host, and moves with it — no host, no channel (never a default)', async () => {
    point.host = 'hypercomb.com'
    const atHost = await ClientPresenceDrone.channel()
    expect(atHost).toBe(sha(`hc:clients\0${roomPreimage('garden', 'rose', 'hypercomb.com')}`))
    expect(atHost).not.toBe(sha('hc:clients\0garden\0rose'))
    point.host = 'point.example'
    expect(await ClientPresenceDrone.channel()).toBe(sha(`hc:clients\0${roomPreimage('garden', 'rose', 'point.example')}`))
    point.host = ''
    expect(await ClientPresenceDrone.channel()).toBe('')
    point.host = 'hypercomb.com'
  })
})

describe('peer-models: lending channels are the room at its point', () => {
  it('subscribes at the point, and a new meeting point resubscribes there', async () => {
    const drone = registry['@diamondcoreprocessor.com/PeerModelsDrone'] as { pulse: (g: string) => Promise<void> }
    subscribed.length = 0
    await drone.pulse('')
    const at = (host: string) => [
      sha(`peer-models:\0${roomPreimage('garden', 'rose', host)}`),
      sha(`peer-model-request:${ME}\0${roomPreimage('garden', 'rose', host)}`),
      sha(`peer-model-reply:${ME}\0${roomPreimage('garden', 'rose', host)}`),
    ]
    await vi.waitFor(() => expect(subscribed).toEqual(expect.arrayContaining(at('hypercomb.com'))))
    expect(subscribed).not.toContain(sha('peer-models:\0garden\0rose'))

    subscribed.length = 0
    point.host = 'point.example'
    EffectBus.emit('mesh:zone', { relay: 'wss://point.example' })
    await vi.waitFor(() => expect(subscribed).toEqual(expect.arrayContaining(at('point.example'))))

    // No host named: no room, so nothing to lend on — never a default's.
    subscribed.length = 0
    point.host = ''
    EffectBus.emit('mesh:zone', { relay: '' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(subscribed).toEqual([])
    point.host = 'hypercomb.com'
  })
})
