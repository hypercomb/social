// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.room-identity.spec.ts — THE ROOM IS HOST + ROOM + SECRET
// (jwize, 2026-10-12: "hash or however we do it (host+location+secret) gen
// keywords from those").
//
// Every address the swarm derives from the room — the lifecycle roster, the
// page channels, the personal channel — hashes `<label> \0 room \0 secret \0
// host` (core roomPreimage), the host being the relay this tab dials (the
// mesh's swarmHost). There is no default host (2026-10-11). Pinned here:
//   0. NO HOST, NO ROOM: a joined tab with a room and a secret but no host
//      subscribes to no room address and says nothing on one — and meets the
//      moment a host is named, without waiting for a walk.
//   1. A tab at hypercomb.com meets at hypercomb.com's addresses — and at
//      none of the addresses a room had before the host was part of it.
//   2. The lifecycle address and the room's two words are ONE preimage.
//   3. Another meeting point, the room and secret unchanged, is another room:
//      the tab meets at the new point's addresses — nothing waited on,
//      nothing asked — and says NO {left} for the old room: the mesh would
//      carry it to the new relay (the old room would never hear it, and that
//      relay would learn the old room's roster address). The old socket's
//      close says it at the old point (the meeting point's will).
//   4. A room or secret change at the SAME point still says {left} there.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lifecyclePreimage, lineageKey, roomPreimage, secretTag } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const ROOM = 'downtown'
const SECRET = 'rose'

const state = vi.hoisted(() => ({ public: new Set<string>() }))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async () => ({}),
  withoutSubstrateImage: <T>(p: T): T => p,
}))
vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: () => null,
}))

/** The addresses a room had before the point was part of it (2026-10-12). */
const before = {
  lifecycle: sha(`lifecycle\0${ROOM}\0${SECRET}`),
  root: sha(`${lineageKey([])}\0${ROOM}\0${SECRET}`),
  channel: sha(`channel:${ME}\0${ROOM}\0${SECRET}`),
  presence: sha(`presence:${ME}\0${ROOM}\0${SECRET}`),
  request: sha(`request:${ME}\0${ROOM}\0${SECRET}`),
}
const at = (point: string) => ({
  lifecycle: sha(lifecyclePreimage(ROOM, SECRET, point)),
  root: sha(`${lineageKey([])}\0${roomPreimage(ROOM, SECRET, point)}`),
  channel: sha(`channel:${ME}\0${roomPreimage(ROOM, SECRET, point)}`),
})

type Published = { kind: number; sig: string; payload: unknown }
const published: Published[] = []
const subscribed: string[] = []
const relay = { host: '' }   // what the mesh's swarmHost answers ('' = nothing named)
const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown) => { published.push({ kind, sig, payload }); return true }),
  subscribe: vi.fn((sig: string) => { subscribed.push(sig); return { close: () => undefined } }),
  awaitReadyForSig: async () => undefined,
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => relay.host,
  nowSec: () => Math.floor(Date.now() / 1000),
  setNetworkEnabled: () => undefined,
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

const childSig = (name: string): string => sha(`child:/${name}`)
const history = {
  sign: async () => 'loc:',
  currentLayerAt: async () => ({ children: ['kite'].map(childSig) }),
  getLayerBySig: async () => ({ name: 'kite' }),
  sealSubtree: async (segments: readonly string[]) => sha(`seal:${segments.join('/')}`),
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => []
  domain = (): string => 'hypercomb.io'
}

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': new FakeLineage(),
  '@diamondcoreprocessor.com/HistoryService': history,
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@hypercomb.social/Store': { hypercombRoot: null },
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: ROOM }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: SECRET }),
  '@diamondcoreprocessor.com/HostSyncService': {
    markPublic: vi.fn(async () => undefined),
    withdrawPublic: vi.fn(),
    isClosureAvailable: vi.fn(async () => false),
    isEnabled: () => false,
  },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

state.public.add('/|kite')
sessionStorage.removeItem('hc:mesh-session')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as {
  markDisposed: () => void
  composeSigForSegments: (segments: readonly string[]) => Promise<string>
  lifecycleSig: () => string
}
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

const used = (): Set<string> => new Set([...published.map(p => p.sig), ...subscribed])
const isLeave = (p: Published): boolean => p.kind === 30206 && JSON.stringify(p.payload ?? '').includes('left')
const isAlive = (p: Published): boolean => p.kind === 30206 && JSON.stringify(p.payload ?? '').includes('alive')

describe('the room is host + room + secret', () => {
  it('NO HOST, NO ROOM: joined with a room and a secret but no host, nothing is subscribed or said at any room address', async () => {
    relay.host = ''
    EffectBus.emit('mesh:public-changed', { public: true })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(published.filter(p => p.kind === 30206 || p.kind === 30200)).toEqual([])
    expect(swarm.lifecycleSig()).toBe('')
    expect(await swarm.composeSigForSegments([])).toBe('')
    // Not hypercomb.com's room, not the room from before the host was in it.
    const seen = used()
    for (const sig of [...Object.values(at('hypercomb.com')), ...Object.values(before)]) expect(seen.has(sig)).toBe(false)
    expect(lifecyclePreimage(ROOM, SECRET, '')).toBe('')
  })

  it('a host named meets there at once — hypercomb.com\'s addresses, none of the old ones', async () => {
    relay.host = 'hypercomb.com'
    EffectBus.emit('mesh:zone', { relay: 'wss://hypercomb.com' })
    await vi.advanceTimersByTimeAsync(1_500)
    const atDefault = at('hypercomb.com')
    // hypercomb.com however it is written is one host.
    expect(atDefault).toEqual(at('wss://HyperComb.com/'))
    expect(published.some(p => isAlive(p) && p.sig === atDefault.lifecycle)).toBe(true)
    expect(subscribed).toContain(atDefault.lifecycle)
    expect(published.some(p => p.kind === 30200 && p.sig === atDefault.root)).toBe(true)
    expect(await swarm.composeSigForSegments([])).toBe(atDefault.root)
    // The roster address host-sync carries on an upload (D7) is this one.
    expect(swarm.lifecycleSig()).toBe(atDefault.lifecycle)
    // Nothing anywhere at an address a room had before the point was in it.
    const seen = used()
    for (const old of Object.values(before)) expect(seen.has(old)).toBe(false)
  })

  it('the lifecycle address and the two words are one preimage', () => {
    const preimage = lifecyclePreimage(ROOM, SECRET, 'hypercomb.com')
    expect(sha(preimage)).toBe(at('hypercomb.com').lifecycle)
    expect(secretTag(preimage, 'en')).toBe(secretTag(`lifecycle\0${ROOM}\0${SECRET}\0hypercomb.com`, 'en'))
  })

  it('another meeting point, room and secret unchanged, is another room: the new point\'s addresses at once — and no {left} carried there', async () => {
    const old = at('hypercomb.com')
    const next = at('pluginthematrix.com')
    expect(next.lifecycle).not.toBe(old.lifecycle)
    expect(next.root).not.toBe(old.root)
    published.length = 0
    subscribed.length = 0

    relay.host = 'pluginthematrix.com'
    EffectBus.emit('mesh:zone', { relay: 'wss://pluginthematrix.com' })
    // Nothing waited on: the move is a teardown and a resync, in this turn's
    // microtasks and the signing they await.
    await vi.advanceTimersByTimeAsync(50)
    expect(published.some(p => isAlive(p) && p.sig === next.lifecycle)).toBe(true)
    expect(subscribed).toContain(next.lifecycle)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(published.some(p => p.kind === 30200 && p.sig === next.root)).toBe(true)
    // Nothing at the old point's addresses once moved — no {left} either:
    // the mesh would have carried it to the new relay.
    expect(published.some(p => p.sig === old.lifecycle || p.sig === old.root)).toBe(false)
    expect(await swarm.composeSigForSegments([])).toBe(next.root)
    expect(swarm.lifecycleSig()).toBe(next.lifecycle)
  })

  it('a relay list that moves under a joined tab with no announcement moves the room at the next sync', async () => {
    const old = at('pluginthematrix.com')
    const next = at('localhost:7801')
    published.length = 0
    relay.host = 'localhost:7801'
    // No mesh:zone — only the tab walking on (any sync).
    ;(registry['@hypercomb.social/Lineage'] as EventTarget).dispatchEvent(new Event('change'))
    await vi.advanceTimersByTimeAsync(1_500)
    expect(published.some(p => isLeave(p) && p.sig === old.lifecycle)).toBe(false)
    expect(published.some(p => isAlive(p) && p.sig === next.lifecycle)).toBe(true)
    expect(published.some(p => p.kind === 30200 && p.sig === next.root)).toBe(true)
  })

  it('a room change at the SAME point still says {left} on the old roster there', async () => {
    const point = 'localhost:7801'
    const old = at(point)
    published.length = 0
    const roomStore = registry['@hypercomb.social/RoomStore'] as EventTarget & { value: string }
    roomStore.value = 'uptown'
    roomStore.dispatchEvent(new Event('change'))
    EffectBus.emit('mesh:room', { room: 'uptown' })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(published.some(p => isLeave(p) && p.sig === old.lifecycle)).toBe(true)
    expect(published.some(p => isAlive(p) && p.sig === sha(lifecyclePreimage('uptown', SECRET, point)))).toBe(true)
  })
})
