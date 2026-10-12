// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// nostr-mesh.real-host-point.spec.ts — THE ROOM'S POINT IS THE RELAY THE TAB
// ATTACHES TO, on a real host too (2026-10-12: the meeting point is part of
// the room, core roomPreimage).
//
// A public page never treats a loopback relay as its point while a reachable
// one is beside it — a peer on another machine can never reach it. But an
// operator who points a real-origin build at the dev relay ALONE (a list
// naming only it, or hc:nostrmesh:allow-loopback) dials nothing else: its
// room is named by that relay, or it derives the hypercomb.com room while
// sitting on localhost, and two tabs on one relay never meet.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: true }))
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

describe('a real host and a loopback relay', () => {
  it('is a real host', () => {
    expect(location.hostname).toBe('hypercomb.io')
  })

  it('a dev relay beside a reachable one: the reachable one is the point', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7777', 'wss://hypercomb.com']))
    const mesh = await boot()
    expect(dialled()).toEqual(['ws://localhost:7777', 'wss://hypercomb.com'])
    expect(mesh.swarmHost()).toBe('hypercomb.com')
  })

  it('the dev relay ALONE, allowed explicitly: it is where the tab meets, so it is the point', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7777']))
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    const mesh = await boot()
    expect(dialled()).toEqual(['ws://localhost:7777'])
    expect(mesh.swarmHost()).toBe('localhost:7777')
  })

  it('a loopback relay it may not dial is never the point', async () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'ws://localhost:7801' }))
    const mesh = await boot()
    expect(dialled()).not.toContain('ws://localhost:7801')
    expect(mesh.swarmHost()).not.toBe('localhost:7801')
  })
})
