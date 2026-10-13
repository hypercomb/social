// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.live-share.spec.ts — THE LIVE SWARM (jwize, 2026-10-11).
//
// "The swarm is different than the public publish because tiles go away when
// the people leave." With no host, a participant's tiles go out FULL —
// takeable, pictures named — served from their own device while they are in
// the room; and a host the participant named that refuses them leaves their
// tiles live the same way (an atom too large for it stays a name, D1).
//
//   - the SHARER (swarm.drone #entryFor): no host → a full entry at once,
//     `served: 'owner'` (`deep: 'owner'` for a branch), host-sync never
//     asked; a host that refuses for good (`ownerHeld`) → live; too large,
//     still uploading → a name; a refusal that lands late walks again;
//   - the RECEIVER: keeps `served: 'owner'`, tells its broker those atoms are
//     claimed by a live peer (raced on the mesh — never `hosted`), their
//     handles as owner roots, and never attributes the page's domain to
//     them;
//   - a SIGNED LEAVE takes them off the grid at once, like any tile.
//
// The live SwarmDrone runs against stubbed IoC peers: a mesh that records
// publishes and lets the test deliver relay events, a layer history, a
// host-sync whose per-page answer and verdicts the test sets, and a broker
// that records what it is told. OWN FILE: EffectBus last-value replay leaks
// across specs sharing a module registry.

import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey, roomPreimage } from '@hypercomb/core'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const PEER = 'b'.repeat(64)
const SIGNED = 'f'.repeat(128)
const ROOM = 'meetup'
const SECRET = '4417'
const POINT = 'jwize.com'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  seal: new Map<string, string>(),
  props: new Map<string, Record<string, unknown>>(),
  // 'location|name' → public; and the public BRANCH roots among them
  public: new Set<string>(),
  branch: new Set<string>(),
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: (location: string, name: string) => state.branch.has(`${location}|${name}`),
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async (_segments: readonly string[], name: string) => ({ ...(state.props.get(name) ?? {}) }),
  withoutSubstrateImage: <T>(p: T): T => p,
}))
vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: () => null,
}))

type Published = { kind: number; sig: string; payload: { visuals?: Record<string, unknown>[] } & Record<string, unknown>; tags: string[][]; at: number }
const published: Published[] = []
type MeshEvt = { relay: string; sig: string; event: Record<string, unknown>; payload: unknown }
const subs = new Map<string, Set<(e: MeshEvt) => void>>()

const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown, tags?: string[][]) => {
    published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), tags: tags ?? [], at: performance.now() })
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
  swarmHost: () => POINT,
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
  sealSubtree: async (segments: readonly string[]) => state.seal.get(segments.join('/')) ?? null,
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

// ── host-sync: where each page's tiles go, and the gate's verdicts ─────────
type Choice = { hosts: string[]; source: string; pending: boolean; passedOver?: string[] }
type Verdict = { ok: boolean | null; ownerHeld?: boolean; unknown?: boolean; blocking?: Record<string, unknown> }
const NONE: Choice = { hosts: [], source: 'none', pending: false }
const pageHosts = new Map<string, Choice>()
const verdicts = new Map<string, Verdict>()
/** Verdicts that answer only after `ms` the FIRST time they are asked. */
const slow = new Map<string, number>()
const asked: string[] = []
const hostSync = {
  markPublic: vi.fn(async () => undefined),
  // Present so the gate is a gate (an older shell without it announces all).
  isClosureAvailable: vi.fn(async () => false),
  isClosureAvailableAt: vi.fn(async () => false),
  closureVerdict: vi.fn(async (sig: string): Promise<Verdict> => {
    asked.push(sig)
    const wait = slow.get(sig)
    if (wait !== undefined) { slow.delete(sig); await new Promise(r => setTimeout(r, wait)) }
    return verdicts.get(sig) ?? { ok: false, ownerHeld: false, blocking: { host: 'friend.example', state: 'syncing', reason: '' } }
  }),
  swarmHostsFor: (segments: readonly string[]): Choice => pageHosts.get(segments.join('/')) ?? NONE,
  warmSwarmHosts: () => undefined,
  isEnabled: () => false,
}

// ── the store: what THIS device holds, and what it weighs (local reads) ────
/** Atoms this device does not hold, and the size of any that is not small. */
const absent = new Set<string>()
const atomBytes = new Map<string, number>()
const localReads: string[] = []
const store = {
  hypercombRoot: null,
  getLayerPoolBytes: async (sig: string): Promise<Uint8Array | null> => {
    localReads.push(sig)
    return absent.has(sig) ? null : new Uint8Array(Math.min(atomBytes.get(sig) ?? 120, 1_024))
  },
  getResourceLocal: async (sig: string): Promise<{ size: number } | null> => {
    localReads.push(sig)
    return absent.has(sig) ? null : { size: atomBytes.get(sig) ?? 2_048 }
  },
}

// ── the broker: what a receiver tells it ───────────────────────────────────
const broker = {
  notePeerLiveness: vi.fn((_pubkey: string, _sigs: readonly string[], _page?: { hosted?: readonly string[]; owner?: readonly string[] }) => undefined),
  noteDomainsForSig: vi.fn((_sig: string, _domains: string[]) => undefined),
}

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': lineage,
  '@diamondcoreprocessor.com/HistoryService': history,
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@hypercomb.social/Store': store,
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: ROOM }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: SECRET }),
  '@diamondcoreprocessor.com/HostSyncService': hostSync,
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

// THIS tab is joined — the per-tab session membership.ts seeds from.
sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as {
  peerTilesAtCurrentSig: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  markDisposed: () => void
}

const shareStatus: Record<string, unknown>[] = []
EffectBus.on<Record<string, unknown>>('swarm:share-status', (p) => { shareStatus.push(p) })

afterAll(() => swarm.markDisposed())

const until = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 5))
  }
}

const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${roomPreimage(ROOM, SECRET, POINT)}`)
const LIFE = sha(`lifecycle\0${roomPreimage(ROOM, SECRET, POINT)}`)
const layerAt = (segments: readonly string[]): Published[] =>
  published.filter(p => p.kind === 30200 && p.sig === pageSig(segments))
const lastLayerAt = (segments: readonly string[]): Published | undefined => layerAt(segments).at(-1)
const domainsAt = (segments: readonly string[]): string[][] => lastLayerAt(segments)!.tags.filter(t => t[0] === 'domain')
const statusAt = (location: string): Record<string, unknown> | undefined =>
  [...shareStatus].reverse().find(s => s['location'] === location)

const seedPage = (segments: string[], names: string[]): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) {
    nameByChildSig.set(childSig(page, n), n)
    state.seal.set([...segments, n].join('/'), sha(`seal:${page}/${n}:v1`))
  }
}
const sealOf = (segments: string[], name: string): string => state.seal.get([...segments, name].join('/'))!
const makePublic = (segments: string[], name: string, branch = false): void => {
  state.public.add(`/${segments.join('/')}|${name}`)
  if (branch) state.branch.add(`/${segments.join('/')}|${name}`)
}

const goTo = async (segments: string[]): Promise<void> => {
  const before = layerAt(segments).length
  state.segments = segments
  lineage.dispatchEvent(new Event('change'))
  await until(() => layerAt(segments).length > before)
}

const nowSec = (): number => Math.floor(Date.now() / 1000)
const deliver = (sig: string, event: Record<string, unknown>, payload: unknown): void => {
  for (const cb of [...(subs.get(sig) ?? [])]) cb({ relay: `wss://${POINT}`, sig, event, payload })
}
const lifecycle = (pubkey: string, payload: Record<string, unknown>, sig: string, createdSec = nowSec()): void => {
  deliver(LIFE, { kind: 30206, pubkey, created_at: createdSec, sig, tags: [['d', pubkey], ['expiration', String(createdSec + 90)]] }, payload)
}

beforeEach(() => {
  asked.length = 0
})

describe('the sharer: no host is a live swarm, never names only', () => {
  it('no host: a public tile goes out FULL at once — served:\'owner\', its handle and picture, no domain — and host-sync is never asked', async () => {
    const page = ['n1']
    seedPage(page, ['sunrise'])
    makePublic(page, 'sunrise')
    state.props.set('sunrise', { accent: 'amber', small: { image: '1'.repeat(64) } })
    await goTo(page)
    const visuals = lastLayerAt(page)!.payload.visuals!
    expect(visuals).toHaveLength(1)
    const [sunrise] = visuals
    expect(sunrise['layerSig']).toBe(sealOf(page, 'sunrise'))
    expect(sunrise['served']).toBe('owner')
    expect(sunrise['small']).toEqual({ image: '1'.repeat(64) })
    expect(sunrise['deep']).toBe('owner')   // its deeper pages too: a take asks this device first
    // Bytes no host keeps: no host is named, and the gate is not asked.
    expect(domainsAt(page)).toEqual([])
    expect(asked).not.toContain(sealOf(page, 'sunrise'))
    // Its marker and edges are still recorded: a host named later is owed it.
    expect(hostSync.markPublic).toHaveBeenCalledWith(sealOf(page, 'sunrise'), 'layer', false, ['n1'])
    expect(statusAt('/n1')).toMatchObject({ offered: 1, live: 1, nameOnly: 0, uploading: 0, host: '', hostSource: 'none', hostState: 'no-host' })
  })

  it('no host: a public BRANCH goes out live with deep:\'owner\' — a take reaches its deeper pages here', async () => {
    const page = ['n2']
    seedPage(page, ['garden'])
    makePublic(page, 'garden', true)
    await goTo(page)
    const [garden] = lastLayerAt(page)!.payload.visuals!
    expect(garden['layerSig']).toBe(sealOf(page, 'garden'))
    expect(garden['served']).toBe('owner')
    expect(garden['deep']).toBe('owner')
    expect(asked).toEqual([])
    // Not "on its way" to anyone: nothing waits on an upload that never runs.
    expect(statusAt('/n2')).toMatchObject({ live: 1, deepOnDevice: 0, uploading: 0, notQueued: 0 })
  })

  it('a named host that refuses for good, or is still uploading, leaves the tile live; too large stays a name; served stays hosted', async () => {
    const page = ['h1']
    pageHosts.set('h1', { hosts: ['friend.example'], source: 'meeting', pending: false })
    seedPage(page, ['refused', 'toobig', 'uploading', 'kept'])
    for (const n of ['refused', 'toobig', 'uploading', 'kept']) makePublic(page, n)
    state.props.set('toobig', { small: { image: '2'.repeat(64) } })
    verdicts.set(sealOf(page, 'refused'), { ok: false, ownerHeld: true, blocking: { host: 'friend.example', state: 'refused', reason: '403 participants-closed' } })
    verdicts.set(sealOf(page, 'toobig'), { ok: false, ownerHeld: true, blocking: { host: 'friend.example', state: 'too-large', reason: '413' } })
    verdicts.set(sealOf(page, 'uploading'), { ok: false, ownerHeld: false, blocking: { host: 'friend.example', state: 'syncing', reason: '' } })
    verdicts.set(sealOf(page, 'kept'), { ok: true, ownerHeld: false })
    await goTo(page)
    const byName = new Map(lastLayerAt(page)!.payload.visuals!.map(v => [String(v['name']), v]))
    expect(byName.get('refused')).toMatchObject({ layerSig: sealOf(page, 'refused'), served: 'owner' })
    expect(byName.get('kept')!['layerSig']).toBe(sealOf(page, 'kept'))
    expect(byName.get('kept')!['served']).toBeUndefined()
    // D1: a picture no host takes for its size is one no broker answer carries.
    expect(byName.get('toobig')!['layerSig']).toBeUndefined()
    expect(JSON.stringify(byName.get('toobig'))).not.toMatch(/[0-9a-f]{64}/)
    // The owner is in the room: an upload still running never holds it back.
    expect(byName.get('uploading')).toMatchObject({ layerSig: sealOf(page, 'uploading'), served: 'owner' })
    // The page's host is still named — for what it does serve.
    expect(domainsAt(page)).toEqual([['domain', 'friend.example']])
    expect(statusAt('/h1')).toMatchObject({ offered: 4, live: 2, nameOnly: 1, host: 'friend.example', hostSource: 'meeting' })
  })

  it('an answer that lands after the walk moved on never holds the tile back — it is live at once', async () => {
    const page = ['h2']
    pageHosts.set('h2', { hosts: ['friend.example'], source: 'meeting', pending: false })
    seedPage(page, ['late'])
    makePublic(page, 'late')
    verdicts.set(sealOf(page, 'late'), { ok: false, ownerHeld: true, blocking: { host: 'friend.example', state: 'refused', reason: '403' } })
    slow.set(sealOf(page, 'late'), 400)   // past the walk's 250 ms wait
    await goTo(page)
    expect(lastLayerAt(page)!.payload.visuals![0]).toMatchObject({ layerSig: sealOf(page, 'late'), served: 'owner' })
  })
})

describe('a live tile is one THIS device can serve: held here, and small enough for a broker answer', () => {
  const NINE_MB = 9 * 1_048_576

  it('no host: a picture over 8 MB, or one not held here, keeps its tile a name, said why; a held one goes live; no host is asked', async () => {
    const page = ['s1']
    seedPage(page, ['beach', 'borrowed', 'fine'])
    for (const n of ['beach', 'borrowed', 'fine']) makePublic(page, n)
    const BIG = 'a1'.repeat(32)
    const GONE = 'a2'.repeat(32)
    const OK = 'a3'.repeat(32)
    state.props.set('beach', { small: { image: BIG } })
    state.props.set('borrowed', { large: { image: GONE } })   // taken from a host; its picture never fetched here
    state.props.set('fine', { small: { image: OK } })
    atomBytes.set(BIG, NINE_MB)
    absent.add(GONE)
    await goTo(page)
    const byName = new Map(lastLayerAt(page)!.payload.visuals!.map(v => [String(v['name']), v]))
    expect(byName.get('fine')).toMatchObject({ layerSig: sealOf(page, 'fine'), served: 'owner', small: { image: OK } })
    for (const n of ['beach', 'borrowed']) {
      expect(byName.get(n)!['layerSig']).toBeUndefined()
      expect(JSON.stringify(byName.get(n))).not.toMatch(/[0-9a-f]{64}/)
    }
    expect(asked).toEqual([])
    // Read from this device only, and nothing here is "on its way".
    expect(localReads).toEqual(expect.arrayContaining([BIG, GONE, OK]))
    expect(statusAt('/s1')).toMatchObject({ offered: 3, live: 1, nameOnly: 2, uploading: 0, notQueued: 2, hostState: 'no-host' })
  })

  it('a host field that refuses the key (the gate answers refused: it never sizes an atom under a 403): a 9 MB picture still keeps the tile a name', async () => {
    const page = ['s2']
    pageHosts.set('s2', { hosts: ['friend.example'], source: 'meeting', pending: false })
    seedPage(page, ['mural', 'sketch'])
    for (const n of ['mural', 'sketch']) makePublic(page, n)
    const BIG = 'b1'.repeat(32)
    state.props.set('mural', { small: { image: BIG } })
    atomBytes.set(BIG, NINE_MB)
    // What the real gate answers under a host-wide 403: the tile's LAYER is
    // the atom in the way, refused; the picture behind it was never asked.
    for (const n of ['mural', 'sketch']) {
      verdicts.set(sealOf(page, n), { ok: false, ownerHeld: true, blocking: { host: 'friend.example', sig: sealOf(page, n), state: 'refused', reason: '403 this host keeps bytes for its own people only' } })
    }
    await goTo(page)
    const byName = new Map(lastLayerAt(page)!.payload.visuals!.map(v => [String(v['name']), v]))
    expect(byName.get('sketch')).toMatchObject({ layerSig: sealOf(page, 'sketch'), served: 'owner' })
    expect(byName.get('mural')!['layerSig']).toBeUndefined()
    expect(JSON.stringify(byName.get('mural'))).not.toMatch(/[0-9a-f]{64}/)
    expect(statusAt('/s2')).toMatchObject({ offered: 2, live: 1, nameOnly: 1 })
  })
})

describe('the receiver: a live peer\'s tiles come from the peer, and leave with them', () => {
  const L1 = '3'.repeat(64)
  const IMG1 = '4'.repeat(64)
  const L2 = '5'.repeat(64)
  const IMG2 = '6'.repeat(64)

  it('keeps served:\'owner\'; the broker hears those atoms claimed by a live peer, the handle as an owner root, and no host is attributed to them', async () => {
    const page = ['r1']
    seedPage(page, [])
    await goTo(page)
    broker.notePeerLiveness.mockClear()
    broker.noteDomainsForSig.mockClear()
    lifecycle(PEER, { alive: true, v: 2 }, SIGNED)
    const sig = pageSig(page)
    deliver(sig, {
      kind: 30200, pubkey: PEER, created_at: nowSec(), sig: SIGNED,
      tags: [['d', sig], ['expiration', String(nowSec() + 90)], ['domain', 'friend.example']],
    }, {
      visuals: [
        { name: 'sunset', layerSig: L1, served: 'owner', small: { image: IMG1 } },
        { name: 'harbor', layerSig: L2, imageSig: IMG2 },
      ],
    })
    await until(() => swarm.peerTilesAtCurrentSig().length === 2)
    const tiles = new Map(swarm.peerTilesAtCurrentSig().map(t => [t.name, t]))
    expect(tiles.get('sunset')!['served']).toBe('owner')
    expect(tiles.get('sunset')!['layerSig']).toBe(L1)
    expect(tiles.get('harbor')!['served']).toBeUndefined()

    expect(broker.notePeerLiveness).toHaveBeenCalledTimes(1)
    const [pubkey, sigs, said] = broker.notePeerLiveness.mock.calls[0]!
    expect(pubkey).toBe(PEER)
    expect([...sigs].sort()).toEqual([L1, IMG1, L2, IMG2].sort())
    // Hosted: only the entry a host serves — read over HTTP first.
    expect([...(said?.hosted ?? [])].sort()).toEqual([L2, IMG2].sort())
    // Owner: the live entry's handle — what lies beneath it, mesh first.
    expect(said?.owner).toEqual([L1])

    // The page's domain is where HOSTED bytes went — never the live ones.
    const attributed = broker.noteDomainsForSig.mock.calls.map(([s]) => s)
    expect(attributed.sort()).toEqual([L2, IMG2].sort())
  })

  it('an older word for served (anything but \'owner\'), or one with no handle, is dropped', async () => {
    const page = ['r2']
    seedPage(page, [])
    await goTo(page)
    const sig = pageSig(page)
    deliver(sig, {
      kind: 30200, pubkey: PEER, created_at: nowSec(), sig: SIGNED,
      tags: [['d', sig], ['expiration', String(nowSec() + 90)]],
    }, {
      visuals: [
        { name: 'odd', layerSig: L1, served: 'anyone' },
        { name: 'bare', served: 'owner' },
      ],
    })
    await until(() => swarm.peerTilesAtCurrentSig().length === 2)
    for (const t of swarm.peerTilesAtCurrentSig()) expect(t['served']).toBeUndefined()
  })

  it('a signed leave takes the live tiles off the grid at once', async () => {
    const page = ['r3']
    seedPage(page, [])
    await goTo(page)
    const LEAVER = 'c'.repeat(64)
    lifecycle(LEAVER, { alive: true, v: 2 }, SIGNED)
    const sig = pageSig(page)
    deliver(sig, {
      kind: 30200, pubkey: LEAVER, created_at: nowSec(), sig: SIGNED,
      tags: [['d', sig], ['expiration', String(nowSec() + 90)]],
    }, { visuals: [{ name: 'campfire', layerSig: L1, served: 'owner', small: { image: IMG1 } }] })
    await until(() => swarm.peerTilesAtCurrentSig().some(t => t.name === 'campfire'))

    lifecycle(LEAVER, { left: true }, SIGNED, nowSec() + 1)   // their own, signed leave
    await until(() => !swarm.peerTilesAtCurrentSig().some(t => t.name === 'campfire'), 1000)
    expect(swarm.peerTilesAtCurrentSig().some(t => t.peerPubkey === LEAVER)).toBe(false)
  })
})
