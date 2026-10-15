// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.room-reads.spec.ts — WHAT THE ROOM READS IS WHAT IS TRUE.
//
//   TS-3   "(N here)" counted anyone who had visited the page this session:
//          sticky mode keeps every visited page announced, so a sharer who
//          walked on still read as standing at root for everyone there. Now a
//          member's newest drill — sent on every arrival, on the lifecycle
//          channel every member hears — says where they stand (or that it is
//          somewhere private), and "here" counts only them.
//   MS5    A waking phone read every slot it held as lapsed (it heard nothing
//          while asleep) and showed an empty room for ~3 s until the replay.
//          The reads now hold off with the sweep (SWEEP_RESUME_DEFER_MS).
//   SCALE-6 Two publishers of one name swapped which variant sat on top at
//          every unchanged 45 s re-send. Order now moves only on a change.
//   SCALE-3 Every received visual claimed all its sigs as a live peer's, so
//          every picture raced the mesh (3-5 relay frames each). Only what is
//          on the publisher's device alone (`deep: 'owner'`) is claimed now.
//   RM-4   A device whose clock was slow signed its first beacon and slots
//          before the relay's clock card — already expired — and nothing
//          re-said them for a whole refresh period. mesh:clock-corrected now
//          re-says everything at once, like a reopened socket.
//
// The live SwarmDrone runs on fake timers against stubbed IoC peers; the mesh
// stub lets the test deliver relay events to the drone's own subscriptions.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey, roomPreimage } from '@hypercomb/core'

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

type Published = { kind: number; sig: string; payload: Record<string, unknown>; tags: string[][]; at: number }
const published: Published[] = []
type MeshEvt = { relay: string; sig: string; event: Record<string, unknown>; payload: unknown }
const subs = new Map<string, Set<(e: MeshEvt) => void>>()
const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown, tags?: string[][]) => {
    published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), tags: tags ?? [], at: Date.now() })
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

const broker = {
  notePeerLiveness: vi.fn(),
  noteDomainsForSig: vi.fn(),
  fetchVisualsAt: vi.fn(async () => []),
}

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': lineage,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@hypercomb.social/Store': { hypercombRoot: null },
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: ROOM }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: SECRET }),
  '@diamondcoreprocessor.com/HostSyncService': {
    markPublic: async () => undefined,
    isClosureAvailable: async () => true,
    isEnabled: () => false,
  },
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

const seedPage = (segments: string[], names: string[], publicNames: string[] = names): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) nameByChildSig.set(childSig(page, n), n)
  for (const n of publicNames) state.public.add(`/${page}|${n}`)
}
seedPage([], ['home', 'r1', 'vault'], ['home', 'r1'])
seedPage(['r1'], ['one'])
seedPage(['vault'], ['private-thing'], [])

const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${roomPreimage(ROOM, SECRET, 'jwize.com')}`)
const LIFE = sha(`lifecycle\0${roomPreimage(ROOM, SECRET, 'jwize.com')}`)
const nowSec = (): number => Math.floor(Date.now() / 1000)
const tick = async (ms = 20): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }
const deliver = (sig: string, event: Record<string, unknown>, payload: unknown): void => {
  for (const cb of [...(subs.get(sig) ?? [])]) cb({ relay: 'wss://jwize.com', sig, event, payload })
}
const peerLayer = (pubkey: string, visuals: Record<string, unknown>[], createdSec = nowSec(), segments: readonly string[] = state.segments): void => {
  const sig = pageSig(segments)
  deliver(sig, { kind: 30200, pubkey, created_at: createdSec, sig: SIGNED, tags: [['d', sig], ['expiration', String(createdSec + 90)]] }, { visuals })
}
const beacon = (pubkey: string): void => {
  const at = nowSec()
  deliver(LIFE, { kind: 30206, pubkey, created_at: at, sig: SIGNED, tags: [['d', pubkey], ['expiration', String(at + 90)]] }, { alive: true, v: 2 })
}
const drill = (pubkey: string, payload: Record<string, unknown>): void => {
  const at = nowSec()
  deliver(LIFE, { kind: 30203, pubkey, created_at: at, sig: SIGNED, tags: [['d', `drill:${pubkey}`], ['expiration', String(at + 90)]] }, payload)
}
const go = async (segments: string[], ms = 1_000): Promise<void> => {
  state.segments = segments
  lineage.dispatchEvent(new Event('change'))
  await tick(ms)
}

sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as {
  participantsAtCurrentSig: () => readonly string[]
  participantsStandingAtCurrentSig: () => readonly string[]
  peerTilesAtCurrentSig: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  markDisposed: () => void
}
const presence: { peers: string[]; at: string[]; zonePeers: { pubkey: string; state: string }[] }[] = []
EffectBus.on<{ peers: string[]; at: string[]; zonePeers: { pubkey: string; state: string }[] }>('swarm:presence-changed', (p) => { presence.push(p) })
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

await tick(1_000)

describe('a slow clock corrected by the relay\'s card (RM-4)', () => {
  it('mesh:clock-corrected re-says the beacon and the page at once — not at the next 45 s refresh', async () => {
    // The first beacon and page slot went out a moment ago (expired on the
    // relay's clock). The card arrives:
    await tick(5_000)
    const from = published.length
    EffectBus.emit('mesh:clock-corrected', { relay: 'wss://jwize.com', offsetMs: 180_000, prevOffsetMs: 0 })
    await tick(100)
    const since = published.slice(from)
    expect(since.some(p => p.kind === 30206 && p.payload['alive'] === true)).toBe(true)
    expect(since.some(p => p.kind === 30200 && p.sig === pageSig([]))).toBe(true)
  })
})

describe('(N here) counts who STANDS here (TS-3)', () => {
  const B = 'b'.repeat(64)
  const OLD = 'c'.repeat(64)

  it('T1c: a sharer who walks on into /b-one stops counting here at once — the slot they keep here does not', async () => {
    beacon(B)
    peerLayer(B, [{ name: 'b-shared' }])
    drill(B, { pathSegments: [] })                     // B stands at root
    await tick(200)
    expect(swarm.participantsStandingAtCurrentSig()).toContain(B)

    drill(B, { pathSegments: ['b-one'] })              // B walks into /b-one
    await tick(200)
    expect(swarm.participantsStandingAtCurrentSig()).not.toContain(B)
    // Their tiles here stay (sticky): shared here, standing elsewhere — and
    // the badge filter, the spotlight and the strip can still isolate them.
    expect(swarm.peerTilesAtCurrentSig().some(t => t.name === 'b-shared')).toBe(true)
    expect(swarm.participantsAtCurrentSig()).toContain(B)
    // The line recounts: B is in the room, elsewhere.
    const last = presence.at(-1)!
    expect(last.at).not.toContain(B)
    expect(last.peers).toContain(B)
    expect(last.zonePeers.find(z => z.pubkey === B)?.state).toBe('elsewhere')

    drill(B, { pathSegments: [] })                     // and back
    await tick(200)
    expect(swarm.participantsStandingAtCurrentSig()).toContain(B)
  })

  it('a member somewhere private (`away`) is not here; one never heard drilling counts as before', async () => {
    drill(B, { away: true })
    await tick(200)
    expect(swarm.participantsStandingAtCurrentSig()).not.toContain(B)
    beacon(OLD)
    peerLayer(OLD, [{ name: 'old-shared' }])
    await tick(200)
    expect(swarm.participantsStandingAtCurrentSig()).toContain(OLD)
  })

  it('this tab says where it stands on EVERY arrival — back to a page within a minute too, and `away` in a private place', async () => {
    const drillsAt = (from: number): Record<string, unknown>[] =>
      published.slice(from).filter(p => p.kind === 30203 && p.sig === LIFE).map(p => p.payload)
    const from = published.length
    await go(['r1'])
    await go([])
    await go(['r1'])
    expect(drillsAt(from)).toEqual([{ pathSegments: ['r1'] }, { pathSegments: [] }, { pathSegments: ['r1'] }])
    const f2 = published.length
    await go(['vault'])                                  // a private tile: its name never leaves
    expect(drillsAt(f2)).toEqual([{ away: true }])
    expect(JSON.stringify(published.slice(f2).map(p => p.payload))).not.toContain('vault')
    await go([])
  })
})

describe('a waking phone keeps the room on screen (MS5)', () => {
  it('sleep.cjs T8: locked 150 s, woken — the last-known tiles stay until the replay, never an empty room', async () => {
    const A = 'd'.repeat(64)
    beacon(A)
    peerLayer(A, [{ name: 'a-one' }, { name: 'a-two' }])
    await tick(200)
    const mine = (): number => swarm.peerTilesAtCurrentSig().filter(t => t.peerPubkey === A).length
    expect(mine()).toBe(2)
    // Locked: no timer runs, the wall clock moves 150 s. Every slot it holds
    // is now past expiration + grace by its own clock.
    vi.setSystemTime(Date.now() + 150_000)
    document.dispatchEvent(new Event('visibilitychange'))   // jsdom: visible
    // Sampled every 100 ms until the replay lands at +3 s (sleep.cjs T8:
    // 23 of 59 samples empty, today).
    let empty = 0
    for (let i = 0; i < 30; i++) {
      if (mine() === 0) empty++
      await tick(100)
    }
    console.info(`[T8 analog] empty samples in the 3 s after wake: ${empty}/30 (hunt, before: 23/59)`)
    expect(empty).toBe(0)
    peerLayer(A, [{ name: 'a-one' }, { name: 'a-two' }])   // the replay
    await tick(100)
    expect(mine()).toBe(2)
  })
})

describe('two publishers of one name keep their order (SCALE-6)', () => {
  it('collision.cjs: six unchanged re-sends 4 s apart — the same variant on top every time', async () => {
    const D = '1'.repeat(64)
    const E = '2'.repeat(64)
    const pic = (who: string): string => sha(`ideas:${who}`)
    peerLayer(D, [{ name: 'ideas', imageSig: pic('d') }])
    await tick(4_000)
    peerLayer(E, [{ name: 'ideas', imageSig: pic('e') }])
    await tick(4_000)
    const orders: string[] = []
    for (let i = 0; i < 6; i++) {
      const who = i % 2 === 0 ? D : E
      peerLayer(who, [{ name: 'ideas', imageSig: pic(who === D ? 'd' : 'e') }])
      await tick(4_000)
      orders.push(swarm.peerTilesAtCurrentSig().filter(t => t.name === 'ideas').map(t => t.peerPubkey === D ? 'd' : 'e').join(''))
    }
    console.info(`[collision analog] order across 6 unchanged re-sends: ${orders.join(' → ')} (hunt, before: ab → ba → ab → ba → ab → ba)`)
    expect(new Set(orders).size).toBe(1)
    // A real change does move it.
    peerLayer(D, [{ name: 'ideas', imageSig: pic('d2') }])
    await tick(200)
    expect(swarm.peerTilesAtCurrentSig().filter(t => t.name === 'ideas')[0]!.peerPubkey).toBe(D)
  })
})

describe('a received page claims only what is on the publisher\'s device alone (SCALE-3, claim half)', () => {
  it('250 pictured, hosted tiles claim nothing — their pictures go to HTTP first', async () => {
    const F = '3'.repeat(64)
    broker.notePeerLiveness.mockClear()
    const visuals = Array.from({ length: 250 }, (_, i) => ({ name: `pic-${i}`, layerSig: sha(`layer:${i}`), small: { image: sha(`img:${i}`) } }))
    peerLayer(F, visuals)
    await tick(200)
    // A sig the page names as `hosted` is never claimed (the broker reads it
    // over HTTP first); only what is left is a mesh-racing claim.
    const claimed = broker.notePeerLiveness.mock.calls.filter(c => c[0] === F)
      .flatMap(c => (c[1] as string[]).filter(s => !((c[2] as { hosted?: string[] } | undefined)?.hosted ?? []).includes(s)))
    console.info(`[focused-pics analog] sigs claimed by a live peer for 250 pictured tiles: ${claimed.length} (before: 500)`)
    expect(claimed.length).toBe(0)
  })

  it('a takeable branch whose deeper pages are on its owner\'s device claims its handle only — and says so on the read', async () => {
    const G = '4'.repeat(64)
    broker.notePeerLiveness.mockClear()
    const layer = sha('layer:big')
    peerLayer(G, [{ name: 'big', layerSig: layer, small: { image: sha('img:big') }, deep: 'owner' }, { name: 'done', layerSig: sha('layer:done'), deep: 'hosted' }])
    await tick(200)
    const call = broker.notePeerLiveness.mock.calls.filter(c => c[0] === G).at(-1)!
    // Every ref is hosted (tile first: its own atoms are on the host); the
    // owner list is what the broker asks of the mesh first beneath it.
    expect((call[2] as { owner: string[] }).owner).toEqual([layer])
    expect([...(call[1] as string[])].sort()).toEqual([...(call[2] as { hosted: string[] }).hosted].sort())
    expect(call[1]).toContain(sha('layer:done'))
    const big = swarm.peerTilesAtCurrentSig().find(t => t.name === 'big' && t.peerPubkey === G)!
    expect(big['deep']).toBe('owner')
    const done = swarm.peerTilesAtCurrentSig().find(t => t.name === 'done' && t.peerPubkey === G)!
    expect(done['deep']).toBe('hosted')
    // Not a closed-enum value: dropped at the trust boundary.
    peerLayer(G, [{ name: 'odd', layerSig: layer, deep: '<script>' }])
    await tick(200)
    expect(swarm.peerTilesAtCurrentSig().find(t => t.name === 'odd')!['deep']).toBeUndefined()
  })

  it("the receiver's presence names whose deeper pages are only on their device, until they are hosted", async () => {
    const J = '7'.repeat(64)
    const layer = sha('layer:deep-owned')
    peerLayer(J, [{ name: 'deep-owned', layerSig: layer, deep: 'owner' }])
    await tick(400)
    expect((presence.at(-1) as { deepOwners?: string[] }).deepOwners).toContain(J)
    peerLayer(J, [{ name: 'deep-owned', layerSig: layer, deep: 'hosted' }])
    await tick(400)
    expect((presence.at(-1) as { deepOwners?: string[] }).deepOwners ?? []).not.toContain(J)
  })

  it('the flip to hosted reaches the broker: the root named again with an EMPTY owner list (BCL-9)', async () => {
    const H = '6'.repeat(64)
    const layer = sha('layer:flip')
    peerLayer(H, [{ name: 'flip', layerSig: layer, deep: 'owner' }])
    await tick(200)
    broker.notePeerLiveness.mockClear()
    peerLayer(H, [{ name: 'flip', layerSig: layer, deep: 'hosted' }])
    await tick(200)
    const call = broker.notePeerLiveness.mock.calls.filter(c => c[0] === H).at(-1)!
    expect(call[1]).toContain(layer)
    expect((call[2] as { owner: string[] }).owner).toEqual([])
  })
})
