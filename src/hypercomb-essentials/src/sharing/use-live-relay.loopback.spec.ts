// @vitest-environment-options {"url": "http://localhost:4250/"}
//
// sharing/use-live-relay.loopback.spec.ts — /use-live-relay on a loopback page
// meets where every install meets (jwize, 2026-10-12: "yes make localhost
// default to hypercomb.com").
//
// It used to keep a loopback page on its seeded local relay ("local relay"),
// so a dev tab and a phone typing the same room met in two rooms — the
// meeting point is part of the room. Pinned: it points at the shipped default
// like a real host does — a relay list the page holds never decides the point
// unseen; a server it names (ws://localhost:7777) is this tab's meeting point.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const roomStore = { value: 'meetup', set: vi.fn((v: string) => { roomStore.value = v }) }
const secretStore = { value: '4417', set: vi.fn((v: string) => { secretStore.value = v }) }
let relays: string[] = []
const mesh = {
  configureRelays: vi.fn((urls: string[]) => { relays = [...urls] }),
  connectAll: vi.fn(),
  getDebug: () => ({ relays }),
}
const registry: Record<string, unknown> = {
  '@hypercomb.social/RoomStore': roomStore,
  '@hypercomb.social/SecretStore': secretStore,
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

sessionStorage.setItem('hc:mesh-session', 'true')   // this tab is joined
await import('./use-live-relay.queen.js')
const queen = registry['@diamondcoreprocessor.com/UseLiveRelayQueenBee'] as { invoke: (args: string) => void }

const toasts: { type: string; message: string }[] = []
EffectBus.on<{ type: string; message: string }>('toast:show', (t) => { if (t) toasts.push(t) })
const zone = (): Record<string, string> | null => JSON.parse(sessionStorage.getItem('hc:mesh-zone') ?? 'null')

beforeEach(() => {
  vi.clearAllMocks()
  toasts.length = 0
  sessionStorage.removeItem('hc:mesh-zone')
  localStorage.clear()
  roomStore.value = 'meetup'
  secretStore.value = '4417'
  relays = []
  EffectBus.emit('mesh:public-changed', { public: true })
})

describe('/use-live-relay on a loopback page', () => {
  it('is on localhost', () => {
    expect(location.hostname).toBe('localhost')
  })

  it('with nothing chosen, meets at the shipped default — as a real host does', () => {
    queen.invoke('garden rose')
    expect(mesh.configureRelays).toHaveBeenCalledWith(['wss://hypercomb.com'], false)
    expect(localStorage.getItem('hc:nostrmesh:use-live-relay')).toBe('1')
    expect(zone()?.relay).toBeUndefined()
    expect(toasts.at(-1)?.message).toContain('live relay')
    expect(toasts.at(-1)?.message).not.toContain('local relay')
  })

  it('a relay list the page holds never decides the point unseen — the live relay, for the session', () => {
    // A list saved long ago (an older run of this word, /domain): the room
    // would have met there — another point is another room — and sent its
    // traffic to every relay in it.
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://jwize.com', 'wss://friend.example']))
    relays = ['wss://jwize.com', 'wss://friend.example']
    queen.invoke('garden rose')
    expect(mesh.configureRelays).toHaveBeenCalledWith(['wss://hypercomb.com'], false)
    expect(relays).toEqual(['wss://hypercomb.com'])
    expect(localStorage.getItem('hc:nostrmesh:use-live-relay')).toBe('1')
    // the saved list is the page's, untouched
    expect(JSON.parse(localStorage.getItem('hc:nostrmesh:relays') ?? '[]')).toEqual(['wss://jwize.com', 'wss://friend.example'])
    expect(toasts.at(-1)?.message).toContain('live relay')
  })

  it('a server named is this tab\'s meeting point — the local relay explicitly', () => {
    queen.invoke('garden rose ws://localhost:7777')
    expect(zone()).toMatchObject({ room: 'garden', secret: 'rose', relay: 'ws://localhost:7777' })
    expect(mesh.configureRelays).toHaveBeenCalledWith(['ws://localhost:7777'], false)
    expect(localStorage.getItem('hc:nostrmesh:relays')).toBeNull()   // never the origin-wide list
  })
})
