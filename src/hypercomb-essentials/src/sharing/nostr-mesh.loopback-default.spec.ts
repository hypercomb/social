// @vitest-environment-options {"url": "http://localhost:4250/"}
//
// nostr-mesh.loopback-default.spec.ts — A LOOPBACK PAGE MEETS WHERE EVERY
// INSTALL MEETS (jwize, 2026-10-12: "yes make localhost default to
// hypercomb.com").
//
// The meeting point is part of the room (core roomPreimage), so a dev page
// seeded onto its own loopback relay met nobody but other dev tabs. Pinned:
//   1. A loopback page with nothing chosen dials wss://hypercomb.com — never
//      ws://localhost:7777 — and its swarmHost (the room's point) says so.
//   2. The local relay still works when CHOSEN: a relay list, or a meeting
//      point in the tab's zone (the selector's field, /use-live-relay with a
//      server).
//   3. A joined tab's meeting point is the room's point at once — before the
//      list has moved in its microtask — so a swarm deriving the room's
//      addresses in the join's own turn already names it.
//   4. '0' still opts out: no relay at all, never a loopback fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: false }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined, tabMeetingHost: () => '' }))

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: FakeWebSocket[] = []
  readyState = 0
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e?: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWebSocket.all.push(this) }
  send(): void { /* nothing is read back here */ }
  close(): void { this.readyState = FakeWebSocket.CLOSED }
}

;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: () => undefined }

const { NostrMeshDrone } = await import('./nostr-mesh.drone.js')
type Mesh = InstanceType<typeof NostrMeshDrone>
let meshes: Mesh[] = []

const boot = async (): Promise<Mesh> => {
  const mesh = new NostrMeshDrone()
  meshes.push(mesh)
  await Promise.resolve()
  return mesh
}
const dialled = (): string[] => [...new Set(FakeWebSocket.all.map(ws => ws.url))]

beforeEach(() => {
  EffectBus.clear()
  FakeWebSocket.all = []
  membership.joined = true
  vi.spyOn(console, 'warn').mockImplementation(() => void 0)
})

afterEach(() => {
  for (const m of meshes) m.stop()
  meshes = []
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('a loopback page with nothing chosen', () => {
  it('is on localhost, and dials the shipped default — never the local relay', async () => {
    expect(location.hostname).toBe('localhost')
    const mesh = await boot()
    expect(dialled()).toEqual(['wss://hypercomb.com'])
    expect(dialled()).not.toContain('ws://localhost:7777')
    expect(mesh.ownRelays()).toEqual(['wss://hypercomb.com'])
    expect(mesh.swarmHost()).toBe('hypercomb.com')
  })

  it("'0' still opts out: no relay at all, never a loopback fallback", async () => {
    localStorage.setItem('hc:nostrmesh:use-live-relay', '0')
    const mesh = await boot()
    expect(dialled()).toEqual([])
    expect(mesh.ownRelays()).toEqual([])
  })
})

describe('the local relay, when it is chosen', () => {
  it('a relay list naming it is dialled, and it is the room\'s point', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7777']))
    const mesh = await boot()
    expect(dialled()).toEqual(['ws://localhost:7777'])
    expect(mesh.swarmHost()).toBe('localhost:7777')
  })

  it('a meeting point in the tab\'s zone is dialled, and is the room\'s point at once — before the list moves', async () => {
    const mesh = await boot()
    expect(mesh.swarmHost()).toBe('hypercomb.com')
    // The selector (or /use-live-relay … ws://localhost:7801) writes the
    // point and announces it; the list moves a microtask later.
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'ws://localhost:7801' }))
    EffectBus.emit('mesh:zone', { relay: 'ws://localhost:7801' })
    expect(mesh.swarmHost()).toBe('localhost:7801')
    await Promise.resolve()
    await Promise.resolve()
    expect(dialled()).toContain('ws://localhost:7801')
    expect(mesh.swarmHost()).toBe('localhost:7801')
  })

  it('a tab that is not joined meets nowhere yet: its point is its own list, not the zone it might join', async () => {
    membership.joined = false
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'ws://localhost:7801' }))
    const mesh = await boot()
    expect(mesh.swarmHost()).toBe('hypercomb.com')
  })
})
