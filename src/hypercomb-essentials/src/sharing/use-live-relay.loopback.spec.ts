// @vitest-environment-options {"url": "http://localhost:4250/"}
//
// sharing/use-live-relay.loopback.spec.ts — /use-live-relay on a loopback page
// meets where its participant says, like every install (jwize, 2026-10-11:
// "The domain on the other hand should not be used" — "Let's just make sure
// that there isn't a default host").
//
// It used to keep a loopback page on its seeded local relay, then on the
// shipped default — either way the page (or the package) chose the host, and
// the host is part of the room. Pinned: with nothing chosen it joins nothing
// and opens the selector on the host field (the words typed kept); the relay
// the page's own list names as chosen is a host the participant chose (made
// this tab's point, shown beside the words); a server it names
// (ws://localhost:7777) is this tab's meeting point.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, lifecyclePreimage, secretTag } from '@hypercomb/core'

/** The room's words at a host, as the toast shows them. */
const wordsAt = (room: string, secret: string, host: string): string => `${secretTag(lifecyclePreimage(room, secret, host), 'en')} · ${host}`

const roomStore = { value: 'meetup', set: vi.fn((v: string) => { roomStore.value = v }) }
const secretStore = { value: '4417', set: vi.fn((v: string) => { secretStore.value = v }) }
let relays: string[] = []
/** What the real mesh's meetingRelay answers: the first relay of the page's
 *  own list as chosen ('' for none). */
let ownPoint = ''
const mesh = {
  configureRelays: vi.fn((urls: string[]) => { relays = [...urls] }),
  connectAll: vi.fn(),
  getDebug: () => ({ relays }),
  meetingRelay: () => ownPoint,
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
  ownPoint = ''
  EffectBus.emit('mesh:public-changed', { public: true })
})

describe('/use-live-relay on a loopback page', () => {
  it('is on localhost', () => {
    expect(location.hostname).toBe('localhost')
  })

  it('with nothing chosen, joins NOTHING: the selector opens on the host field, the words typed kept', () => {
    const opened: unknown[] = []
    const off = EffectBus.on('mesh:open-modal', (p) => { opened.push(p) })
    queen.invoke('garden rose')
    off()
    expect(opened.at(-1)).toEqual({ join: true, focus: 'point' })
    // nothing pointed, no live relay forced, no host written for the tab
    expect(mesh.configureRelays).not.toHaveBeenCalled()
    expect(localStorage.getItem('hc:nostrmesh:use-live-relay')).toBeNull()
    expect(zone()?.relay).toBeUndefined()
    // the room and secret the person typed are in, for START
    expect(zone()).toMatchObject({ room: 'garden', secret: 'rose' })
    expect(roomStore.value).toBe('garden')
    // never the page's own domain, never a default
    expect(toasts.at(-1)?.type).toBe('tip')
    expect(toasts.at(-1)?.message).not.toContain('localhost')
  })

  it('the relay the page\'s own list names (as chosen) is a host the participant chose — made this tab\'s point, shown beside the words', () => {
    // A list `/domain wss://friend.example` saved over the old default: the
    // mesh reads the default riding ahead as the seed (R4) and answers the
    // typed relay as the point.
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://jwize.com', 'wss://friend.example']))
    ownPoint = 'wss://friend.example'
    queen.invoke('garden rose')
    expect(zone()).toMatchObject({ room: 'garden', secret: 'rose', relay: 'wss://friend.example' })
    expect(mesh.configureRelays).toHaveBeenCalledWith(['wss://friend.example'], false)
    expect(localStorage.getItem('hc:nostrmesh:use-live-relay')).toBeNull()
    // the saved list is the page's, untouched
    expect(JSON.parse(localStorage.getItem('hc:nostrmesh:relays') ?? '[]')).toEqual(['wss://jwize.com', 'wss://friend.example'])
    expect(toasts.at(-1)?.message).toContain(wordsAt('garden', 'rose', 'friend.example'))
  })

  it('a server named is this tab\'s meeting point — the local relay explicitly', () => {
    queen.invoke('garden rose ws://localhost:7777')
    expect(zone()).toMatchObject({ room: 'garden', secret: 'rose', relay: 'ws://localhost:7777' })
    expect(mesh.configureRelays).toHaveBeenCalledWith(['ws://localhost:7777'], false)
    expect(localStorage.getItem('hc:nostrmesh:relays')).toBeNull()   // never the origin-wide list
    // a host the participant typed is named beside the words — loopback too
    expect(toasts.at(-1)?.message).toContain(wordsAt('garden', 'rose', 'localhost:7777'))
  })
})
