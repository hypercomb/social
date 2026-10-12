// nostr-mesh.default-relay.spec.ts — THE OFFERED MEETING POINT, NEVER SEEDED.
//
// jwize, 2026-10-11: "we can't rely on my computer being on that is ridiculous
// for my setup" → "yes, open default on hypercomb.com, go ahead" → "Let's just
// make sure that there isn't a default host" — "hypercomb.com should be
// available but not filled by default for new installs". Pinned here:
//   1. A real host with no list of its own dials NOTHING — even with the
//      runtime's one-time live-relay flag set — and names no host.
//   2. A participant who names hypercomb.com meets there and offers it no
//      access code (D8: the open point; a code on it would hot-loop old
//      packages).
//   3. The host the participant entered IS the host field — the swarm's
//      upload host when the page wears no publish domain (jwize 2026-10-11:
//      "the source of truth is the host field"), whatever its card says;
//      nothing seeds a hosts pool, and no pool picks a host.
//   4. An operator can still name any relay, jwize.com included.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: true }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined, tabMeetingHost: () => '' }))

const HERE = dirname(fileURLToPath(import.meta.url))

type Frame = unknown[]

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: FakeWebSocket[] = []

  readyState = 0
  bufferedAmount = 0
  sent: Frame[] = []
  protocols: string[]
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e?: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string, protocols?: string | string[]) {
    this.protocols = protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols]
    FakeWebSocket.all.push(this)
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError')
    this.sent.push(JSON.parse(data) as Frame)
  }
  close(): void { this.readyState = FakeWebSocket.CLOSED }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  receive(msg: Frame): void { this.onmessage?.({ data: JSON.stringify(msg) }) }
  card(extra: Record<string, unknown> = {}): void {
    this.receive(['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: Math.floor(Date.now() / 1000), participants: false, ...extra })])
  }
}

const services: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrSigner': {
    signEvent: async (e: Record<string, unknown>) => ({ ...e, id: '1'.padStart(64, '0'), pubkey: 'a'.repeat(64), sig: 'f'.repeat(128) }),
  },
}
;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: (k: string) => services[k] }

const { NostrMeshDrone, chosenRelays } = await import('./nostr-mesh.drone.js')
const { SwarmHostResolver, liveSwarmHostDeps } = await import('./swarm-hosts.js')
const { originOf } = await import('./zone-door.js')
type Mesh = InstanceType<typeof NostrMeshDrone>

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
let meshes: Mesh[] = []

const settle = async (turns = 10): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setTimeout(resolve, 0))
}

/** A fresh mesh on a real host: the live-relay flag is on (what the runtime
 *  seeds on every deployed origin), and nothing else is configured. */
const bootFresh = async (): Promise<Mesh> => {
  localStorage.setItem('hc:nostrmesh:use-live-relay', '1')
  const mesh = new NostrMeshDrone()
  meshes.push(mesh)
  services[MESH_KEY] = mesh
  await Promise.resolve()
  return mesh
}

/** A joined tab whose participant named hypercomb.com in the host field. */
const bootDefault = async (): Promise<Mesh> => {
  sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'wss://hypercomb.com' }))
  const mesh = new NostrMeshDrone()
  meshes.push(mesh)
  services[MESH_KEY] = mesh
  await Promise.resolve()
  return mesh
}

beforeEach(() => {
  EffectBus.clear()
  FakeWebSocket.all = []
  membership.joined = true
  vi.spyOn(console, 'warn').mockImplementation(() => void 0)
})

afterEach(() => {
  for (const m of meshes) m.stop()
  meshes = []
  delete services[MESH_KEY]
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('the offered meeting point — never seeded', () => {
  it('is wss://hypercomb.com — the anchor every reader of the offer sees says so', () => {
    const relays = (globalThis as Record<string, unknown>)['__HYPERCOMB_RELAYS__'] as { live?: string } | undefined
    expect(relays?.live).toBe('wss://hypercomb.com')
  })

  it('a real host with no list of its own dials NOTHING, live-relay flag or not, and names no host', async () => {
    const mesh = await bootFresh()
    expect(FakeWebSocket.all).toHaveLength(0)
    expect(mesh.swarmHost()).toBe('')
    expect(mesh.meetingRelay()).toBe('')
    expect(mesh.ownRelays()).toEqual([])
    // Joined with no host: it says so, at once — never "connecting" for ever.
    expect(mesh.connectionState().refused).toBe('no-host')
  })

  it('named in the host field, it is dialled, and offered no access code', async () => {
    const mesh = await bootDefault()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual(['wss://hypercomb.com'])
    expect(FakeWebSocket.all[0]!.protocols).toEqual([])
    expect(mesh.swarmHost()).toBe('hypercomb.com')
    expect(mesh.connectionState().refused).toBeUndefined()
    // The page's own list is still empty: the point is the tab's, not a seed.
    expect(mesh.ownRelays()).toEqual([])
  })

  it('an operator may still name another relay — jwize.com included', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://jwize.com']))
    const mesh = await bootFresh()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual(['wss://jwize.com'])
    expect(mesh.swarmHost()).toBe('jwize.com')
  })
})

describe('the meeting point entered is the host field — the upload host, whatever its card says', () => {
  it('with no publish domain, a page\'s bytes go to the point the participant entered, written https://<host>', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://hypercomb.com']))
    const mesh = await bootDefault()
    const ws = FakeWebSocket.all[0]!
    ws.open()
    // The point's card says it hosts nobody's bytes: that decides nothing —
    // the host the participant entered is asked, and its answer decides.
    ws.card({ participants: false, addressed: true })
    expect(mesh.relayParticipants()).toBe(false)

    // The live deps read the mesh through IoC, as host-sync's resolver does.
    const resolver = new SwarmHostResolver({
      ...liveSwarmHostDeps,
      readMarks: async () => [],
      originLoopback: () => false,
      session: () => null,
    })
    resolver.warm(null)
    resolver.warm(['meetup'])
    await settle()
    const choice = resolver.hostsFor(['meetup'])
    expect(choice).toEqual({ hosts: ['hypercomb.com'], source: 'meeting', pending: false })
    expect(originOf(choice.hosts[0])).toBe('https://hypercomb.com')
    expect(resolver.relayHost()).toBe('hypercomb.com')
  })

  it('nothing seeds a hosts pool: a friend\'s point is the host, never a shipped one', async () => {
    expect(readFileSync(join(HERE, 'hosts.drone.ts'), 'utf8')).not.toMatch(/\bSEED_HOST\b/)
    // The tab's zone names the host the participant entered (round two: the
    // zone's relay IS the meeting point); the page list says the same.
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://friend.example']))
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'wss://friend.example' }))
    const mesh = new NostrMeshDrone()
    meshes.push(mesh)
    services[MESH_KEY] = mesh
    await Promise.resolve()
    FakeWebSocket.all[0]!.open()
    FakeWebSocket.all[0]!.card({ participants: 'all', addressed: true })
    const resolver = new SwarmHostResolver({
      ...liveSwarmHostDeps,
      readMarks: async () => [],
      originLoopback: () => false,
      session: () => null,
    })
    resolver.warm(null)
    await settle()
    expect(resolver.hostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    expect(resolver.hostsFor(null).hosts).toEqual([mesh.swarmHost()])
  })
})

describe('what an older package stored is seed or choice (R4, 2026-10-11)', () => {
  // git history: the mesh wrote its hard relay at every boot (2026-02-26 →
  // 03-19), and `/domain <url>` saves [...the list it dialled, url] — with
  // nothing saved, that list was the package's seed. Nothing else ever stored
  // a default; `/use-live-relay <server>` stored exactly what was typed.
  it('a boot-written hard relay alone is the seed: nothing is chosen, nothing dialled', async () => {
    for (const seed of ['wss://nos.lol', 'wss://relay.snort.social']) {
      expect(chosenRelays([seed])).toEqual([])
    }
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://relay.snort.social']))
    const mesh = await bootFresh()
    expect(FakeWebSocket.all).toHaveLength(0)
    expect(mesh.swarmHost()).toBe('')
    // Read only — the stored list is never rewritten or deleted for it.
    expect(localStorage.getItem('hc:nostrmesh:relays')).toBe(JSON.stringify(['wss://relay.snort.social']))
  })

  it('a default /domain carried ahead of what was typed is the seed riding along; the typed relay is the point', async () => {
    expect(chosenRelays(['wss://jwize.com', 'wss://x.example'])).toEqual(['wss://x.example'])
    expect(chosenRelays(['ws://localhost:7777', 'wss://x.example'])).toEqual(['wss://x.example'])
    expect(chosenRelays(['wss://hypercomb.com', 'wss://x.example'])).toEqual(['wss://x.example'])
    expect(chosenRelays(['wss://relay.snort.social', 'wss://x.example'])).toEqual(['wss://x.example'])
    // the retired stale-dev-list guard appended the live relay to a loopback list
    expect(chosenRelays(['ws://localhost:7777', 'wss://jwize.com', 'wss://x.example'])).toEqual(['wss://x.example'])
    expect(chosenRelays(['ws://localhost:7801', 'wss://jwize.com', 'wss://x.example'])).toEqual(['ws://localhost:7801', 'wss://x.example'])
    // a default TYPED last is the person's
    expect(chosenRelays(['ws://localhost:7777', 'wss://hypercomb.com'])).toEqual(['wss://hypercomb.com'])

    const stored = JSON.stringify(['wss://jwize.com', 'wss://x.example'])
    localStorage.setItem('hc:nostrmesh:relays', stored)
    const mesh = await bootFresh()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual(['wss://x.example'])
    expect(mesh.swarmHost()).toBe('x.example')
    expect(localStorage.getItem('hc:nostrmesh:relays')).toBe(stored)
  })

  it('a list a person wrote whole is theirs — a default typed alone included', () => {
    for (const typed of ['wss://jwize.com', 'ws://localhost:7777', 'wss://hypercomb.com', 'wss://x.example']) {
      expect(chosenRelays([typed])).toEqual([typed])
    }
    expect(chosenRelays(['wss://a.example', 'wss://b.example'])).toEqual(['wss://a.example', 'wss://b.example'])
  })

  it('only the HEAD of an old list is ever a seed: nothing after a typed entry is dropped', () => {
    // an old real-host package: its seed, then hypercomb.com typed, then y
    expect(chosenRelays(['wss://jwize.com', 'wss://hypercomb.com', 'wss://y.example'])).toEqual(['wss://hypercomb.com', 'wss://y.example'])
    // typed first, a default typed after it, then another: all the person's
    expect(chosenRelays(['wss://x.example', 'wss://hypercomb.com', 'wss://y.example'])).toEqual(['wss://x.example', 'wss://hypercomb.com', 'wss://y.example'])
    expect(chosenRelays(['wss://x.example', 'ws://localhost:7777', 'wss://jwize.com', 'wss://y.example']))
      .toEqual(['wss://x.example', 'ws://localhost:7777', 'wss://jwize.com', 'wss://y.example'])
  })
})

describe('a list this package saves is the participant\'s, whole (no seed rule)', () => {
  it('the default typed, then a second relay: both kept, and the point stays the first — across a reload', async () => {
    const mesh = await bootFresh()
    mesh.configureOwnRelays(['wss://hypercomb.com'])                      // `/domain wss://hypercomb.com`
    mesh.configureOwnRelays([...mesh.ownRelays(), 'wss://other.example'])  // `/domain wss://other.example`
    expect(mesh.swarmHost()).toBe('hypercomb.com')
    expect(JSON.parse(localStorage.getItem('hc:nostrmesh:relays')!)).toEqual(['hc:chosen', 'wss://hypercomb.com', 'wss://other.example'])
    mesh.stop()
    // the reload reads back exactly what the session dialled: same host, same words
    const reloaded = await bootFresh()
    expect(reloaded.ownRelays()).toEqual(['wss://hypercomb.com', 'wss://other.example'])
    expect(reloaded.swarmHost()).toBe('hypercomb.com')
    // and a later `/domain` edit never rewrites the typed default away
    reloaded.configureOwnRelays([...reloaded.ownRelays(), 'wss://third.example'])
    expect(JSON.parse(localStorage.getItem('hc:nostrmesh:relays')!))
      .toEqual(['hc:chosen', 'wss://hypercomb.com', 'wss://other.example', 'wss://third.example'])
  })

  it('a relay a boot write once stored, typed by a person on this package, is theirs', async () => {
    const mesh = await bootFresh()
    mesh.configureOwnRelays(['wss://nos.lol'])
    mesh.stop()
    const reloaded = await bootFresh()
    expect(reloaded.ownRelays()).toEqual(['wss://nos.lol'])
    expect(reloaded.swarmHost()).toBe('nos.lol')
  })

  it('an older package reading the saved list passes over the mark (it keeps only ws(s) entries)', () => {
    const saved = ['hc:chosen', 'wss://hypercomb.com', 'wss://other.example']
    expect(saved.filter(u => u.startsWith('ws://') || u.startsWith('wss://'))).toEqual(['wss://hypercomb.com', 'wss://other.example'])
  })
})

describe('a host let go before the join is not the next join\'s host', () => {
  it('a not-joined tab whose host field named x, then was emptied, keeps nothing of x', async () => {
    membership.joined = false
    const mesh = await bootFresh()
    // the selector's Save with x in the field: the zone names it, the mesh is pointed
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'wss://x.example' }))
    mesh.configureRelays(['wss://x.example'], false)
    EffectBus.emit('mesh:zone', { relay: 'wss://x.example' })
    await settle(2)
    expect(mesh.meetingRelay()).toBe('wss://x.example')
    // the field emptied and saved again: the zone names no host
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's' }))
    EffectBus.emit('mesh:zone', { relay: '' })
    await settle(2)
    expect(mesh.meetingRelay()).toBe('')
    expect(mesh.ownRelays()).toEqual([])
    expect(mesh.swarmHost()).toBe('')
    // and a join then dials nothing, and says there is no host
    const dialled = FakeWebSocket.all.length
    membership.joined = true
    EffectBus.emit('mesh:public-changed', { public: true })
    await settle(2)
    expect(FakeWebSocket.all.slice(dialled).map(ws => ws.url)).toEqual([])
    expect(mesh.connectionState().refused).toBe('no-host')
  })

  it('a not-joined tab whose zone still names its host keeps it until it is let go — then its own list', async () => {
    membership.joined = false
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['hc:chosen', 'wss://own.example']))
    const mesh = await bootFresh()
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'wss://x.example' }))
    mesh.configureRelays(['wss://x.example'], false)
    EffectBus.emit('mesh:zone', { relay: 'wss://x.example' })
    await settle(2)
    expect(mesh.meetingRelay()).toBe('wss://x.example')
    // let go: back to the page's own list, never x
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's' }))
    EffectBus.emit('mesh:zone', { relay: '' })
    await settle(2)
    expect(mesh.meetingRelay()).toBe('wss://own.example')
    expect(mesh.ownRelays()).toEqual(['wss://own.example'])
  })
})
