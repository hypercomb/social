// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// nostr-mesh.real-host-point.spec.ts — THE PAGE NEVER PICKS THE POINT
// (jwize, 2026-10-11: "The domain on the other hand should not be used
// (current address in the browser)").
//
// The room is named by the relay the participant named (core roomPreimage),
// and the answer is the SAME on a real host as on a loopback page: the point
// a joined tab's zone names, else the first relay of its own list. A real
// host used to pass a loopback relay over for a reachable one beside it, and
// to append the live relay to a loopback-only list — the page's own domain
// choosing the room, so two tabs that named one relay read two rooms. Whether
// THIS page may dial the point is a separate answer: a loopback point it may
// not dial is refused ('unreachable') and the tab meets nowhere — never at a
// relay it can reach under another room's name.

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

  it('a dev relay named first is the point — on a real host exactly as on a loopback page', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7801', 'wss://hypercomb.com']))
    const mesh = await boot()
    expect(dialled()).toEqual(['ws://localhost:7801', 'wss://hypercomb.com'])
    expect(mesh.swarmHost()).toBe('localhost:7801')
  })

  it('a package default `/domain` stored ahead of a typed relay is not chosen (R4): the typed relay is the point', async () => {
    // ws://localhost:7777 was the loopback seed: `/domain wss://hypercomb.com`
    // on a page with nothing saved stored exactly this list.
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7777', 'wss://hypercomb.com']))
    const mesh = await boot()
    expect(dialled()).toEqual(['wss://hypercomb.com'])
    expect(mesh.swarmHost()).toBe('hypercomb.com')
  })

  it('the dev relay ALONE is dialled as named — no live relay appended because the page is a real host', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7777']))
    const mesh = await boot()
    expect(dialled()).toEqual(['ws://localhost:7777'])
    expect(mesh.swarmHost()).toBe('localhost:7777')
  })

  it('allowed explicitly, the same', async () => {
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(['ws://localhost:7777']))
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    const mesh = await boot()
    expect(dialled()).toEqual(['ws://localhost:7777'])
    expect(mesh.swarmHost()).toBe('localhost:7777')
  })

  it('a loopback point this page may not dial is still the point — never dialled, refused unreachable, never swapped for another relay', async () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', relay: 'ws://localhost:7801' }))
    const mesh = await boot()
    expect(dialled()).not.toContain('ws://localhost:7801')
    expect(dialled()).toEqual([])
    expect(mesh.swarmHost()).toBe('localhost:7801')
    expect(mesh.connectionState().refused).toBe('unreachable')
  })
})
