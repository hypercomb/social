// nostr-mesh.default-relay.spec.ts — THE SHIPPED DEFAULT MEETING POINT.
//
// jwize, 2026-10-11: "we can't rely on my computer being on that is ridiculous
// for my setup" → "yes, open default on hypercomb.com, go ahead". Pinned here:
//   1. A real host with no list of its own dials wss://hypercomb.com — the
//      always-online meeting point — and offers it no access code (D8: the
//      shipped default is open; a code on it would hot-loop old packages).
//   2. Its card makes it the relay tier of the swarm's upload hosts: with no
//      publish domain, meeting host or pool host, a page's bytes go to
//      hypercomb.com, written https://hypercomb.com — and the pool's own seed
//      (hosts.drone SEED_HOST) is the same host, so the two tiers agree.
//   3. An operator can still name any relay, jwize.com included.

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

const { NostrMeshDrone } = await import('./nostr-mesh.drone.js')
const { SwarmHostResolver, liveSwarmHostDeps } = await import('./swarm-hosts.js')
const { originOf } = await import('./zone-door.js')
type Mesh = InstanceType<typeof NostrMeshDrone>

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
let meshes: Mesh[] = []

const settle = async (turns = 10): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setTimeout(resolve, 0))
}

/** A fresh mesh on a real host: the live relay is on (what the runtime seeds
 *  on every deployed origin), and nothing else is configured. */
const bootDefault = async (): Promise<Mesh> => {
  localStorage.setItem('hc:nostrmesh:use-live-relay', '1')
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

describe('the shipped default meeting point', () => {
  it('is wss://hypercomb.com — the anchor every reader of the default sees says so', () => {
    const relays = (globalThis as Record<string, unknown>)['__HYPERCOMB_RELAYS__'] as { live?: string } | undefined
    expect(relays?.live).toBe('wss://hypercomb.com')
  })

  it('a real host with no list of its own dials it, and offers it no access code', async () => {
    const mesh = await bootDefault()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual(['wss://hypercomb.com'])
    expect(FakeWebSocket.all[0]!.protocols).toEqual([])
    expect(mesh.swarmHost()).toBe('hypercomb.com')
    expect(mesh.ownRelays()).toEqual(['wss://hypercomb.com'])
  })

  it('an operator may still name another relay — jwize.com included', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['wss://jwize.com']))
    const mesh = await bootDefault()
    expect(FakeWebSocket.all.map(ws => ws.url)).toEqual(['wss://jwize.com'])
    expect(mesh.swarmHost()).toBe('jwize.com')
  })
})

describe('its card makes it the relay tier of the upload hosts', () => {
  it('with no publish domain, meeting host or pool host, a page\'s bytes go to https://hypercomb.com', async () => {
    const mesh = await bootDefault()
    const ws = FakeWebSocket.all[0]!
    ws.open()
    ws.card({ participants: 'all', addressed: true })
    expect(mesh.relayParticipants()).toBe('all')
    expect(mesh.relaysAddressed()).toBe(true)

    // The live deps read the mesh through IoC, as host-sync's resolver does.
    const resolver = new SwarmHostResolver({
      ...liveSwarmHostDeps,
      readPool: async () => [],              // a seeded pool the participant emptied
      readMarks: async () => [],
      originLoopback: () => false,
      meetingHost: () => '',
      session: () => null,
    })
    resolver.warm(null)
    resolver.warm(['meetup'])
    await settle()
    const choice = resolver.hostsFor(['meetup'])
    expect(choice).toEqual({ hosts: ['hypercomb.com'], source: 'relay', pending: false })
    expect(originOf(choice.hosts[0])).toBe('https://hypercomb.com')
    expect(resolver.relayHost()).toBe('hypercomb.com')
  })

  it('the pool\'s seed is the same host, so the pool tier and the relay tier agree', async () => {
    const seed = /const SEED_HOST = '([^']+)'/.exec(readFileSync(join(HERE, 'hosts.drone.ts'), 'utf8'))?.[1]
    expect(seed).toBe('hypercomb.com')
    const mesh = await bootDefault()
    FakeWebSocket.all[0]!.open()
    FakeWebSocket.all[0]!.card({ participants: 'all', addressed: true })
    const resolver = new SwarmHostResolver({
      ...liveSwarmHostDeps,
      readPool: async () => [seed!],         // a fresh install's pool
      readMarks: async () => [],
      originLoopback: () => false,
      meetingHost: () => '',
      session: () => null,
    })
    resolver.warm(null)
    await settle()
    expect(resolver.hostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    expect(resolver.hostsFor(null).hosts).toEqual([mesh.swarmHost()])
  })
})
