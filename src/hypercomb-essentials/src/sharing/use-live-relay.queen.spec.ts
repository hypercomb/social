// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/use-live-relay.queen.spec.ts — the one-command setup is QUIET.
//
// Typed mid-meeting, the bare form used to drag the participant out of their
// room into 'hive', re-point the mesh at the relay it already held (tearing
// the live socket down), and switch on the public content worker. Now: the
// bare form keeps the zone THIS tab is in (and its meeting point), a tab with
// none of its own is asked in the selector, the mesh is re-pointed only when
// the relay differs, and swarm sharing never touches the worker.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const roomStore = { value: 'meetup', set: vi.fn((v: string) => { roomStore.value = v }) }
const secretStore = { value: '4417', set: vi.fn((v: string) => { secretStore.value = v }) }
let relays: string[] = ['wss://jwize.com']
const mesh = {
  configureRelays: vi.fn((urls: string[]) => { relays = [...urls] }),
  connectAll: vi.fn(),
  getDebug: () => ({ relays }),
}
const hostSync = {
  enablePublicHost: vi.fn(),
  isEnabled: () => false,
  isPublicHostEnabled: () => false,
}
const registry: Record<string, unknown> = {
  '@hypercomb.social/RoomStore': roomStore,
  '@hypercomb.social/SecretStore': secretStore,
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/HostSyncService': hostSync,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

sessionStorage.setItem('hc:mesh-session', 'true')   // this tab is joined
const { zoneWords } = await import('./use-live-relay.queen.js')
const queen = registry['@diamondcoreprocessor.com/UseLiveRelayQueenBee'] as { invoke: (args: string) => void }

const invokes: unknown[] = []
EffectBus.on('keymap:invoke', (p) => { invokes.push(p) })
const toasts: { type: string; message: string }[] = []
EffectBus.on<{ type: string; message: string }>('toast:show', (t) => { if (t) toasts.push(t) })
const points: unknown[] = []
EffectBus.on('mesh:zone', (p) => { if (p) points.push(p) })
const modals: unknown[] = []
EffectBus.on('mesh:open-modal', (p) => { if (p) modals.push(p) })

beforeEach(() => {
  vi.clearAllMocks()
  invokes.length = 0
  toasts.length = 0
  points.length = 0
  modals.length = 0
  sessionStorage.removeItem('hc:mesh-zone')
  localStorage.removeItem('hc:nostrmesh:relays')
  roomStore.value = 'meetup'
  secretStore.value = '4417'
  relays = ['wss://jwize.com']
  EffectBus.emit('mesh:public-changed', { public: true })
})

describe('/use-live-relay', () => {
  it('bare, in a zone: keeps the room and secret, leaves the relay alone, never enables the worker', () => {
    queen.invoke('')
    expect(roomStore.set).not.toHaveBeenCalled()
    expect(secretStore.set).not.toHaveBeenCalled()
    expect(roomStore.value).toBe('meetup')
    expect(secretStore.value).toBe('4417')
    expect(mesh.configureRelays).not.toHaveBeenCalled()
    expect(hostSync.enablePublicHost).not.toHaveBeenCalled()
    expect(invokes).toEqual([])                       // already joined — no toggle
  })

  it('bare, on a tab with no zone of its own: the selector, pre-filled — never hive/hive, never the pre-fill joined (D5)', () => {
    EffectBus.emit('mesh:public-changed', { public: false })
    sessionStorage.removeItem('hc:mesh-zone')
    roomStore.value = 'downtown'                       // last week's pre-fill
    secretStore.value = 'rose'
    queen.invoke('')
    expect(roomStore.set).not.toHaveBeenCalled()
    expect(secretStore.set).not.toHaveBeenCalled()
    expect(invokes).toEqual([])                        // no join
    expect(modals).toEqual([{ join: true }])
    expect(toasts.at(-1)?.type).toBe('tip')
    roomStore.value = ''
    secretStore.value = ''
    modals.length = 0
    queen.invoke('')
    expect(roomStore.set).not.toHaveBeenCalled()
    expect(modals).toEqual([{ join: true }])
  })

  it('bare with only a server, no zone of its own: the selector carries the point', () => {
    EffectBus.emit('mesh:public-changed', { public: false })
    sessionStorage.removeItem('hc:mesh-zone')
    queen.invoke('wss://pluginthematrix.com')
    expect(modals).toEqual([{ join: true, point: 'wss://pluginthematrix.com' }])
    expect(sessionStorage.getItem('hc:mesh-zone')).toBeNull()   // START writes it, a cancel leaves nothing
    expect(invokes).toEqual([])
  })

  it('re-points the mesh only when the relay differs', () => {
    relays = ['wss://elsewhere.example']
    queen.invoke('')
    expect(mesh.configureRelays).toHaveBeenCalledTimes(1)
    expect(mesh.configureRelays).toHaveBeenCalledWith(['wss://jwize.com'], false)
  })

  it('a named zone is set, and an unjoined tab joins through the one guarded gesture', () => {
    EffectBus.emit('mesh:public-changed', { public: false })
    queen.invoke('garden rose')
    expect(roomStore.set).toHaveBeenCalledWith('garden')
    expect(secretStore.set).toHaveBeenCalledWith('rose')
    expect(invokes).toEqual([{ cmd: 'mesh.togglePublic', binding: null, event: null }])
    expect(hostSync.enablePublicHost).not.toHaveBeenCalled()
  })

  it('keeps the room and secret exactly as typed — the same words from a link meet in the same zone', () => {
    // The command line lower-cases a word's arguments unless the word keeps
    // them verbatim (rawArgs). Mixed case here split a meeting in two.
    expect((queen as { rawArgs?: boolean }).rawArgs).toBe(true)
    queen.invoke('Garden Rose')
    expect(roomStore.set).toHaveBeenCalledWith('Garden')
    expect(secretStore.set).toHaveBeenCalledWith('Rose')
  })

  it('off leaves only a joined tab', () => {
    EffectBus.emit('mesh:public-changed', { public: false })
    queen.invoke('off')
    expect(invokes).toEqual([])
    EffectBus.emit('mesh:public-changed', { public: true })
    queen.invoke('off')
    expect(invokes).toEqual([{ cmd: 'mesh.togglePublic', binding: null, event: null }])
  })

  it('an explicit server is THIS tab\'s meeting point — kept for its reload, never the origin-wide list', () => {
    queen.invoke('downtown downtown wss://PluginTheMatrix.com/io/')
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toMatchObject({ relay: 'wss://pluginthematrix.com/io' })
    expect(localStorage.getItem('hc:nostrmesh:relays')).toBeNull()   // other tabs (other meetings) never dial it
    expect(mesh.configureRelays).toHaveBeenCalledWith(['wss://pluginthematrix.com/io'], false)
    expect(points).toEqual([{ relay: 'wss://pluginthematrix.com/io' }])
  })

  it('a different server is a different meeting: the old one\'s code and host stay behind', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meetup', secret: '4417', relay: 'wss://a.example', host: 'a.example', code: 'k' }))
    queen.invoke('meetup 4417 wss://b.example')
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toEqual({ room: 'meetup', secret: '4417', relay: 'wss://b.example' })
  })

  it('the bare form in this tab\'s meeting keeps its meeting point and code (ZI-1)', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meetup', secret: '4417', relay: 'wss://a.example', code: 'k' }))
    relays = ['wss://a.example']
    queen.invoke('')
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toEqual({ room: 'meetup', secret: '4417', relay: 'wss://a.example', code: 'k' })
    expect(mesh.configureRelays).not.toHaveBeenCalled()
    expect(points).toEqual([])
  })

  it('the same room and secret typed again keep it too — retyping never splits a meeting (ZI-1)', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meetup', secret: '4417', relay: 'wss://a.example', code: 'k' }))
    relays = ['wss://a.example']
    queen.invoke('meetup 4417')
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toMatchObject({ relay: 'wss://a.example', code: 'k' })
    expect(mesh.configureRelays).not.toHaveBeenCalled()
  })

  it('another room is another meeting: back to the live relay, the point and code let go', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meetup', secret: '4417', relay: 'wss://a.example', code: 'k' }))
    relays = ['wss://a.example']
    queen.invoke('garden rose')
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toEqual({ room: 'garden', secret: 'rose' })
    expect(mesh.configureRelays).toHaveBeenCalledWith(['wss://jwize.com'], false)
    expect(points).toEqual([{ relay: '' }])
  })

  it('a quoted room keeps its space, straight or curly quotes (ZI-8)', () => {
    queen.invoke('"Garden Rose" rose')
    expect(roomStore.set).toHaveBeenCalledWith('Garden Rose')
    expect(secretStore.set).toHaveBeenCalledWith('rose')
    vi.clearAllMocks()
    queen.invoke('“North Side”')
    expect(roomStore.set).toHaveBeenCalledWith('North Side')
    expect(secretStore.set).toHaveBeenCalledWith('North Side')
  })

  it('every word is folded as the selector folds it (ZI-5)', () => {
    queen.invoke('ｄｏｗｎ joe’s​')
    expect(roomStore.set).toHaveBeenCalledWith('down')
    expect(secretStore.set).toHaveBeenCalledWith("joe's")
  })

  it('zoneWords: quotes group, an unclosed quote runs to the end, nothing empty', () => {
    expect(zoneWords('  a  "b c"  d ')).toEqual(['a', 'b c', 'd'])
    expect(zoneWords('"open quote rest')).toEqual(['open quote rest'])
    expect(zoneWords('"" a')).toEqual(['a'])
  })

  it('clear lets this tab\'s meeting point go too', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'meetup', secret: '4417', relay: 'wss://a.example', host: 'a.example', code: 'k' }))
    queen.invoke('clear')
    expect(JSON.parse(sessionStorage.getItem('hc:mesh-zone')!)).toEqual({ room: 'meetup', secret: '4417' })
  })

  it('refuses extra words, by name — the third word was the secret someone meant', () => {
    queen.invoke('pluginthematrix.com downtown downtown')
    expect(roomStore.set).not.toHaveBeenCalled()
    expect(secretStore.set).not.toHaveBeenCalled()
    expect(invokes).toEqual([])
    expect(toasts.at(-1)?.type).toBe('error')
    expect(toasts.at(-1)?.message).toContain("'downtown'")
  })

  it('refuses a server no tab can dial (ws:// off loopback)', () => {
    queen.invoke('garden rose ws://pluginthematrix.com')
    expect(roomStore.set).not.toHaveBeenCalled()
    expect(toasts.at(-1)?.type).toBe('error')
  })

  it('the success toast points at the room line — no second word formula here', async () => {
    const { secretTag } = await import('@hypercomb/core')
    queen.invoke('garden rose')
    expect(toasts.at(-1)?.type).toBe('success')
    expect(toasts.at(-1)?.message).toContain('"garden"')
    expect(toasts.at(-1)?.message).toContain('room line')
    expect(toasts.at(-1)?.message).not.toContain(secretTag('lifecycle\0garden\0rose', 'en'))
  })
})
