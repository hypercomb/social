// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm-reconnect.spec.ts — presence that is accurate but forgiving.
//
//   - a reopened socket beacons FIRST, then the page, then visited pages;
//   - our own tombstone, older or newer than our beacon, reasserts us;
//   - the relay's unsigned will marks a peer AWAY and keeps their tiles;
//     only their signed leave evicts;
//   - content follows the relay slot: an entry leaves at expiration + 30 s;
//   - a late (frozen) or just-resumed sweep judges nobody;
//   - a pagehide is not a leave.
//
// The live SwarmDrone runs on fake timers against stubbed IoC peers; the mesh
// stub records publishes and lets the test deliver relay events to the
// drone's own subscriptions.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const SIGNED = 'f'.repeat(128)
const ROOM = 'meetup'
const SECRET = '4417'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  public: new Set<string>(),
  // A slow signer for the zone's lifecycle sig — makes "beacon first" a
  // property of the code's ordering, not of which await chain is shorter.
  lifecycleSignMs: 0,
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: () => false,
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

type Published = { kind: number; sig: string; payload: Record<string, unknown>; tags: string[][] }
const published: Published[] = []
type MeshEvt = { relay: string; sig: string; event: Record<string, unknown>; payload: unknown }
const subs = new Map<string, Set<(e: MeshEvt) => void>>()

const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown, tags?: string[][]) => {
    published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), tags: tags ?? [] })
    return true
  }),
  subscribe: vi.fn((sig: string, cb: (e: MeshEvt) => void) => {
    let set = subs.get(sig)
    if (!set) { set = new Set(); subs.set(sig, set) }
    set.add(cb)
    return { close: () => { set!.delete(cb) } }
  }),
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => 'jwize.com',
  nowSec: () => Math.floor(Date.now() / 1000),
  setNetworkEnabled: () => undefined,
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

const childSig = (page: string, name: string): string => sha(`child:${page}/${name}`)
const nameByChildSig = new Map<string, string>()
const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) => `loc:${(l.explorerSegments?.() ?? []).join('/')}`,
  currentLayerAt: async (locSig: string) => {
    const kids = state.children.get(locSig.slice(4))
    return kids ? { children: kids.map(n => childSig(locSig.slice(4), n)) } : null
  },
  getLayerBySig: async (sig: string) => ({ name: nameByChildSig.get(sig) }),
  sealSubtree: async (segments: readonly string[]) => sha(`seal:${segments.join('/')}`),
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': lineage,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@hypercomb/SignatureStore': {
    signText: async (s: string) => {
      if (s.startsWith('lifecycle\0') && state.lifecycleSignMs > 0) await new Promise(r => setTimeout(r, state.lifecycleSignMs))
      return sha(s)
    },
  },
  '@hypercomb.social/Store': { hypercombRoot: null },
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: ROOM }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: SECRET }),
  '@diamondcoreprocessor.com/HostSyncService': {
    markPublic: async () => undefined,
    isClosureAvailable: async () => true,
    isEnabled: () => false,
  },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

const seedPage = (segments: string[], names: string[]): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) {
    nameByChildSig.set(childSig(page, n), n)
    state.public.add(`/${page}|${n}`)
  }
}
seedPage([], ['home'])
seedPage(['r1'], ['one'])

sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
// The constructor armed the sweep and the heartbeat (both 30 s) right now.
const BOOT_MS = Date.now()
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as {
  peerTilesAtCurrentSig: () => readonly { name: string; peerPubkey: string }[]
  participantsInZone: () => readonly string[]
  awayInZone: () => readonly string[]
  debug: () => { peerLayersBySig: Record<string, { peers: string[] }> }
  markDisposed: () => void
}

const peersChanged: { sig: string; pubkey?: string; reason: string }[] = []
EffectBus.on<{ sig: string; pubkey?: string; reason: string }>('swarm:peers-changed', (p) => { peersChanged.push(p) })

afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

const settle = async (ms = 20): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }
const nowSec = (): number => Math.floor(Date.now() / 1000)
const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${ROOM}\0${SECRET}`)
const LIFE = sha(`lifecycle\0${ROOM}\0${SECRET}`)

const deliver = (sig: string, event: Record<string, unknown>, payload: unknown): void => {
  for (const cb of [...(subs.get(sig) ?? [])]) cb({ relay: 'wss://jwize.com', sig, event, payload })
}
const peerLayer = (pubkey: string, name: string, expSec: number, createdSec = nowSec()): void => {
  const sig = pageSig(state.segments)
  deliver(sig, { kind: 30200, pubkey, created_at: createdSec, sig: SIGNED, tags: [['d', sig], ['expiration', String(expSec)]] },
    { visuals: [{ name }] })
}
const lifecycle = (pubkey: string, payload: Record<string, unknown>, sig: string, createdSec = nowSec()): void => {
  deliver(LIFE, { kind: 30206, pubkey, created_at: createdSec, sig, tags: [['d', pubkey], ['expiration', String(createdSec + 90)]] }, payload)
}
const slotExpired = (pubkey: string): boolean => peersChanged.some(p => p.reason === 'slot-expired' && p.pubkey === pubkey)
const heldBy = (pubkey: string): boolean =>
  Object.values(swarm.debug().peerLayersBySig).some(b => b.peers.includes(pubkey.slice(0, 8)))
const tileNames = (): string[] => swarm.peerTilesAtCurrentSig().map(t => t.name)

/** The next time the drone's 30 s sweep fires (it was armed at BOOT_MS). */
const nextSweepMs = (): number => {
  const since = Date.now() - BOOT_MS
  return BOOT_MS + (Math.floor(since / 30_000) + 1) * 30_000
}

// Boot: the lineage hook syncs the root page, beacons, walks.
await settle(50)

describe('reconnect and presence', () => {
  it('boots joined: beacons { alive, v: 2 } and announces the page', () => {
    const beacon = published.find(p => p.kind === 30206)
    expect(beacon?.payload).toEqual({ alive: true, v: 2 })
    expect(published.some(p => p.kind === 30200 && p.sig === pageSig([]))).toBe(true)
  })

  it('a reopened socket publishes the beacon (30206) before any layer (30200), then the visited pages', async () => {
    // Visit r1 and come back, so r1 is a visited (sticky) page.
    state.segments = ['r1']
    lineage.dispatchEvent(new Event('change'))
    await settle()
    state.segments = []
    lineage.dispatchEvent(new Event('change'))
    await settle()

    published.length = 0
    state.lifecycleSignMs = 10
    EffectBus.emit('mesh:connection', { state: 'open', reopened: true, since: Date.now(), attempt: 1, clockOffsetMs: 0 })
    await settle(40)
    state.lifecycleSignMs = 0
    const kinds = published.map(p => p.kind)
    expect(kinds.indexOf(30206)).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf(30200)).toBeGreaterThan(kinds.indexOf(30206))
    // The page we stand on re-announces at once, past the "already sent" memo.
    expect(published.some(p => p.kind === 30200 && p.sig === pageSig([]))).toBe(true)
    // Visited pages follow inside the 5 s spread.
    await settle(5_100)
    expect(published.some(p => p.kind === 30200 && p.sig === pageSig(['r1']))).toBe(true)
  })

  it('our own tombstone reasserts us — an OLDER one too (a beacon a dead socket swallowed must not block recovery)', async () => {
    published.length = 0
    lifecycle(ME, { left: true }, '', nowSec() - 600)
    await settle(1_200)
    expect(published.some(p => p.kind === 30206 && p.payload['alive'] === true)).toBe(true)

    published.length = 0
    lifecycle(ME, { left: true }, '', nowSec())
    await settle(1_200)
    expect(published.some(p => p.kind === 30206 && p.payload['alive'] === true)).toBe(true)
    expect(published.some(p => p.kind === 30200)).toBe(true)
  })

  it('the relay\'s unsigned will marks a peer away and keeps their tiles; their signed leave evicts', async () => {
    const PEER = 'b'.repeat(64)
    peerLayer(PEER, 'peer-tile', nowSec() + 90)
    lifecycle(PEER, { alive: true, v: 2 }, SIGNED)
    await settle()
    expect(tileNames()).toContain('peer-tile')
    expect(swarm.participantsInZone()).toContain(PEER)

    lifecycle(PEER, { left: true }, '', nowSec() + 1)        // relay-made: sig ''
    await settle()
    expect(tileNames()).toContain('peer-tile')
    expect(swarm.awayInZone()).toContain(PEER)
    expect(swarm.participantsInZone()).not.toContain(PEER)

    // A replay of their slot from before the will does not bring them back…
    peerLayer(PEER, 'peer-tile', nowSec() + 90, nowSec() - 5)
    expect(swarm.participantsInZone()).not.toContain(PEER)
    // …their own next word does.
    lifecycle(PEER, { alive: true, v: 2 }, SIGNED, nowSec() + 2)
    expect(swarm.participantsInZone()).toContain(PEER)

    lifecycle(PEER, { left: true }, SIGNED, nowSec() + 3)    // their own leave
    await settle()
    expect(tileNames()).not.toContain('peer-tile')
    expect(swarm.awayInZone()).not.toContain(PEER)
  })

  it('an entry leaves at its own expiration + 30 s — not before', async () => {
    const PEER = 'c'.repeat(64)
    peerLayer(PEER, 'short-lived', nowSec() + 5)
    await settle()
    expect(tileNames()).toContain('short-lived')

    await settle(34_000)                                     // every sweep here is ≤ expiration + 30
    expect(heldBy(PEER)).toBe(true)
    expect(slotExpired(PEER)).toBe(false)

    await settle(31_000)                                     // one sweep lands past expiration + 30
    expect(slotExpired(PEER)).toBe(true)
    expect(heldBy(PEER)).toBe(false)
    expect(tileNames()).not.toContain('short-lived')
  })

  it('a sweep right after the tab resumes judges nobody', async () => {
    const PEER = 'd'.repeat(64)
    await settle(nextSweepMs() - Date.now() - 5_000)         // 5 s before a sweep
    peerLayer(PEER, 'resumed', nowSec() - 28)               // inside its grace now, past it at the sweep
    window.dispatchEvent(new Event('pageshow'))             // the phone wakes
    await settle(6_000)                                      // that sweep falls inside the deferral
    expect(slotExpired(PEER)).toBe(false)
    expect(heldBy(PEER)).toBe(true)

    await settle(30_000)                                     // the next one judges again
    expect(slotExpired(PEER)).toBe(true)
  })

  it('a sweep that runs more than 2× late (a frozen tab) skips', async () => {
    const PEER = 'e'.repeat(64)
    await settle(nextSweepMs() - Date.now() + 1_000)         // just after a sweep
    peerLayer(PEER, 'frozen', nowSec() - 10)
    // The tab freezes for 100 s: the wall clock jumps, no timer ran.
    vi.setSystemTime(Date.now() + 100_000)
    await settle(29_500)                                     // the overdue sweep fires late
    expect(slotExpired(PEER)).toBe(false)
    expect(heldBy(PEER)).toBe(true)
    // The reopened socket's replay refreshes the slot before an on-time
    // sweep judges: the tile never left.
    peerLayer(PEER, 'frozen', nowSec() + 90)
    await settle(30_000)
    expect(slotExpired(PEER)).toBe(false)
    expect(tileNames()).toContain('frozen')
  })

  it('a pagehide is not a leave — nothing is sent', async () => {
    published.length = 0
    window.dispatchEvent(new Event('pagehide'))
    await settle()
    expect(published.some(p => p.payload['left'] === true)).toBe(false)
  })

  // Last: it leaves the zone.
  it('a leave hands the signed {left} to the socket BEFORE the network goes, and says nothing into the room after', async () => {
    const order: string[] = []
    mesh.publish.mockImplementation(async (kind: number, sig: string, payload: unknown, tags?: string[][]) => {
      published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), tags: tags ?? [] })
      order.push(`publish:${kind}:${(payload as { left?: boolean }).left === true ? 'left' : ''}`)
      return true
    })
    ;(mesh as { setNetworkEnabled: (on: boolean) => void }).setNetworkEnabled = (on: boolean) => { order.push(`network:${on}`) }
    published.length = 0
    EffectBus.emit('mesh:public-changed', { public: false })
    await settle()
    expect(order).toEqual(['publish:30206:left', 'network:false'])

    // A receipt or an edit landing after the leave announces nothing.
    published.length = 0
    EffectBus.emit('host:receipt', { sig: 'e'.repeat(64), host: 'jwize.com', swarm: true })
    EffectBus.emit('cell:0000-changed', {})
    await settle(1_000)
    expect(published).toEqual([])
  })
})
