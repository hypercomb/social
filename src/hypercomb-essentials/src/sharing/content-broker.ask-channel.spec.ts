// content-broker.ask-channel.spec.ts — the room asks; nobody else can hear.
//
// An ask names what it wants (`d`) — a visuals ask names the room's own
// composed location — so the channel decides who learns a room's addresses.
// Pinned here:
//   1. A joined tab asks on its ROOM's channel, sign('broker:fetch\0room\0secret'),
//      and on nothing anyone can derive without the secret.
//   2. Out of a room (or not joined) it asks nothing over the mesh and listens
//      to nothing — its bytes come from hosts.
//   3. THE DRAIN: in a room it also listens on the old word, so an older build's
//      ask is answered; once an older build has been heard asking, its own asks
//      also go to the word, marked — and a current holder skips a marked copy
//      (it heard the room one).
//   4. A change of room, secret or membership moves the channel.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: false }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined }))

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registrations.set(key, value) },
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.boot.drone.js').ContentBrokerDrone

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const STORE_KEY = '@hypercomb.social/Store'
const WORD = 'broker:fetch'
const OLDER = 'b'.repeat(64)
const CURRENT = 'c'.repeat(64)

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}
const channelOf = (room: string, secret: string): Promise<string> => sha256(new TextEncoder().encode(`broker:fetch\0${room}\0${secret}`))

type Evt = { kind: number; pubkey: string; tags: string[][]; content: string }
type Published = { kind: number; sig: string; tags: string[][] }

class FakeMesh {
  published: Published[] = []
  subs = new Map<string, Set<(e: { event: Evt; payload: unknown }) => void>>()
  publish = async (kind: number, sig: string, _payload: unknown, tags: string[][] = []): Promise<boolean> => {
    this.published.push({ kind, sig, tags })
    return true
  }
  subscribe = (sig: string, cb: (e: { event: Evt; payload: unknown }) => void): { close: () => void } => {
    let set = this.subs.get(sig)
    if (!set) { set = new Set(); this.subs.set(sig, set) }
    set.add(cb)
    return { close: () => { set!.delete(cb) } }
  }
  deliver(sig: string, event: Evt): void { for (const cb of this.subs.get(sig) ?? []) cb({ event, payload: null }) }
  listening = (): string[] => [...this.subs].filter(([, set]) => set.size > 0).map(([sig]) => sig).sort()
  asks = (kind = 20400): Published[] => this.published.filter(p => p.kind === kind)
}

const ask = (pubkey: string, d: string, type: string, extra: string[][] = []): Evt =>
  ({ kind: 20400, pubkey, tags: [['x', WORD], ['d', d], ['t', type], ...extra], content: '' })

let mesh: FakeMesh

const enterRoom = (room: string, secret: string): void => {
  registrations.set(ROOM_KEY, { value: room })
  registrations.set(SECRET_KEY, { value: secret })
}

const boot = async (): Promise<InstanceType<typeof ContentBrokerDrone>> => {
  const broker = new ContentBrokerDrone()
  await vi.waitFor(() => expect(mesh.subs.size + (membership.joined ? 0 : 1)).toBeGreaterThan(0))
  await new Promise(resolve => setTimeout(resolve, 20))
  return broker
}

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.boot.drone.js'))
})

beforeEach(() => {
  EffectBus.clear()
  registrations.clear()
  mesh = new FakeMesh()
  registrations.set(MESH_KEY, mesh)
  membership.joined = false
  // No host answers: every fetch reaches the mesh leg.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the ask channel is the room', () => {
  it('a joined tab listens on its room channel and asks only there', async () => {
    membership.joined = true
    enterRoom('alpha', 'secret')
    const channel = await channelOf('alpha', 'secret')
    const broker = await boot()
    await vi.waitFor(() => expect(mesh.listening()).toEqual([channel, WORD].sort()))

    const wanted = 'a'.repeat(64)
    expect(await broker.fetchBySig(wanted, 'layer', 150)).toBeNull()
    expect(mesh.asks()).toEqual([{ kind: 20400, sig: channel, tags: [['d', wanted], ['t', 'layer']] }])
    // Nothing went anywhere a scanner could name.
    expect(mesh.published.every(p => p.sig === channel)).toBe(true)
  })

  it('out of a room — or not joined — asks nothing over the mesh and hears nothing', async () => {
    enterRoom('alpha', 'secret')
    const broker = await boot()
    expect(mesh.listening()).toEqual([])
    expect(await broker.fetchBySig('a'.repeat(64), 'layer', 150)).toBeNull()
    expect(await broker.fetchVisualsAt('d'.repeat(64), 150)).toBeNull()
    expect(mesh.published).toEqual([])

    // Joined, but the room has no secret: still nothing.
    membership.joined = true
    registrations.set(SECRET_KEY, { value: '' })
    EffectBus.emit('mesh:public-changed', { public: true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mesh.listening()).toEqual([])
    expect(await broker.fetchBySig('e'.repeat(64), 'resource', 150)).toBeNull()
    expect(mesh.published).toEqual([])
  })

  it('a change of room, secret or membership moves the channel', async () => {
    membership.joined = true
    enterRoom('alpha', 'secret')
    const alpha = await channelOf('alpha', 'secret')
    const beta = await channelOf('beta', 'secret')
    await boot()
    await vi.waitFor(() => expect(mesh.listening()).toEqual([alpha, WORD].sort()))

    enterRoom('beta', 'secret')
    EffectBus.emit('mesh:room', { room: 'beta' })
    await vi.waitFor(() => expect(mesh.listening()).toEqual([beta, WORD].sort()))

    membership.joined = false
    EffectBus.emit('mesh:public-changed', { public: false })
    await vi.waitFor(() => expect(mesh.listening()).toEqual([]))
  })
})

describe('the drain: the older word, room-scoped by the relay', () => {
  it("answers an older build's ask, then asks where older builds listen — marked", async () => {
    membership.joined = true
    enterRoom('alpha', 'secret')
    const channel = await channelOf('alpha', 'secret')
    const held = new TextEncoder().encode('a layer this tab holds')
    const heldSig = await sha256(held)
    registrations.set(STORE_KEY, { getLayerLocalBytes: async (sig: string) => (sig === heldSig ? held : null) })
    const broker = await boot()
    await vi.waitFor(() => expect(mesh.listening()).toEqual([channel, WORD].sort()))

    // A current build's word copy (marked) is skipped: it was heard on the room channel.
    mesh.deliver(WORD, ask(CURRENT, heldSig, 'layer', [['asked', 'room']]))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mesh.published.filter(p => p.kind === 30401)).toEqual([])
    // Before any older build is heard, asks stay on the room channel.
    expect(await broker.fetchBySig('a'.repeat(64), 'layer', 150)).toBeNull()
    expect(mesh.asks().map(p => p.sig)).toEqual([channel])

    // An older build asks on the word (unmarked): it is answered, at the sig.
    mesh.deliver(WORD, ask(OLDER, heldSig, 'layer'))
    await vi.waitFor(() => expect(mesh.published.filter(p => p.kind === 30401).map(p => p.sig)).toEqual([heldSig]))

    // … and from now on this tab's asks also reach the word, marked.
    mesh.published = []
    expect(await broker.fetchBySig('f'.repeat(64), 'layer', 150)).toBeNull()
    expect(mesh.asks()).toEqual([
      { kind: 20400, sig: channel, tags: [['d', 'f'.repeat(64)], ['t', 'layer']] },
      { kind: 20400, sig: WORD, tags: [['d', 'f'.repeat(64)], ['t', 'layer'], ['asked', 'room']] },
    ])
  })
})
