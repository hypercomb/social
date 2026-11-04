// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.image-share.spec.ts — EVERYBODY BRINGS THEIR OWN PICTURE, LIVE.
//
// The two promises, run against the real SwarmDrone and the real peer-image
// reader (stubbed IoC peers around them, the same harness as live-share):
//
//   1. THE ICON: when several participants publish a tile of the same name,
//      each with their own picture, the images icon is offered and the wall's
//      candidates carry EVERY participant's picture, each named by who shows it.
//   2. EDITING IN THE SWARM: a picture the sharer changes (editor save, or a
//      pick on the wall) goes out again at once on the tile's page, so every
//      participant's candidates follow it — the new picture arrives, the old
//      one from the same publisher is replaced, not stacked.
//
// OWN FILE: EffectBus last-value replay leaks across specs sharing a module
// registry.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey, roomPreimage } from '@hypercomb/core'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const PEER_ANA = 'b'.repeat(64)
const PEER_BEN = 'c'.repeat(64)
const SIGNED = 'f'.repeat(128)
const ROOM = 'meetup'
const SECRET = '4417'
const POINT = 'jwize.com'

const MINE_SMALL = '1'.repeat(64)
const MINE_NEXT = '2'.repeat(64)
const ANA_SMALL = '3'.repeat(64)
const ANA_NEXT = '4'.repeat(64)
const BEN_SMALL = '5'.repeat(64)
const BEN_LARGE = '6'.repeat(64)

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  seal: new Map<string, string>(),
  props: new Map<string, Record<string, unknown>>(),
  public: new Set<string>(),
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: () => false,
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

type Published = { kind: number; sig: string; payload: { visuals?: Record<string, unknown>[] } & Record<string, unknown>; tags: string[][] }
const published: Published[] = []
type MeshEvt = { relay: string; sig: string; event: Record<string, unknown>; payload: unknown; signed?: boolean }
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

const hostSync = {
  markPublic: vi.fn(async () => undefined),
  isClosureAvailable: vi.fn(async () => false),
  isClosureAvailableAt: vi.fn(async () => false),
  closureVerdict: vi.fn(async () => ({ ok: false, ownerHeld: false, blocking: { host: 'friend.example', state: 'syncing', reason: '' } })),
  swarmHostsFor: () => ({ hosts: [], source: 'none', pending: false }),
  warmSwarmHosts: () => undefined,
  isEnabled: () => false,
}
const store = {
  hypercombRoot: null,
  getLayerPoolBytes: async (): Promise<Uint8Array | null> => new Uint8Array(120),
  getResourceLocal: async (): Promise<{ size: number } | null> => ({ size: 2_048 }),
}
const broker = {
  notePeerLiveness: vi.fn(() => undefined),
  noteDomainsForSig: vi.fn(() => undefined),
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

sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as {
  peerTilesAtCurrentSig: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  markDisposed: () => void
}
const { peerImageCandidates, hasPeerImages } = await import('./peer-images.js')

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

const seedPage = (segments: string[], names: string[]): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) {
    nameByChildSig.set(childSig(page, n), n)
    state.seal.set([...segments, n].join('/'), sha(`seal:${page}/${n}:v1`))
  }
}
const makePublic = (segments: string[], name: string): void => {
  state.public.add(`/${segments.join('/')}|${name}`)
}
const goTo = async (segments: string[]): Promise<void> => {
  const before = layerAt(segments).length
  state.segments = segments
  lineage.dispatchEvent(new Event('change'))
  await until(() => layerAt(segments).length > before)
}

const nowSec = (): number => Math.floor(Date.now() / 1000)
let clock = nowSec()
const deliver = (sig: string, event: Record<string, unknown>, payload: unknown): void => {
  // `signed` is the mesh's admission verdict: a sig means it verified there, '' is the relay's will.
  const signed = String((event as { sig?: unknown })['sig'] ?? '') !== ''
  for (const cb of [...(subs.get(sig) ?? [])]) cb({ relay: `wss://${POINT}`, sig, event, payload, signed })
}
const lifecycle = (pubkey: string): void => {
  deliver(LIFE, { kind: 30206, pubkey, created_at: clock, sig: SIGNED, tags: [['d', pubkey], ['expiration', String(clock + 90)]] }, { alive: true, v: 2 })
}
/** A participant announces the tiles they show on this page. A newer
 *  announcement from the same participant replaces their last. */
const announce = (segments: string[], pubkey: string, visuals: Record<string, unknown>[]): void => {
  clock += 1
  const sig = pageSig(segments)
  deliver(sig, {
    kind: 30200, pubkey, created_at: clock, sig: SIGNED,
    tags: [['d', sig], ['expiration', String(clock + 90)]],
  }, { visuals })
}
const layerSigOf = (who: string, name: string): string => sha(`layer:${who}/${name}`)

describe('the images icon in a swarm', () => {
  it('offers every participant\'s picture for a tile of the same name, each named', async () => {
    const page = ['wall1']
    seedPage(page, [])
    await goTo(page)
    lifecycle(PEER_ANA)
    lifecycle(PEER_BEN)
    announce(page, PEER_ANA, [{ name: 'sunrise', layerSig: layerSigOf('ana', 'sunrise'), served: 'owner', small: { image: ANA_SMALL } }])
    announce(page, PEER_BEN, [{ name: 'sunrise', layerSig: layerSigOf('ben', 'sunrise'), served: 'owner', small: { image: BEN_SMALL } }])
    await until(() => swarm.peerTilesAtCurrentSig().length === 2)

    const found = peerImageCandidates('sunrise')
    expect(found.map(c => c.previewSig).sort()).toEqual([ANA_SMALL, BEN_SMALL].sort())
    expect(new Set(found.flatMap(c => c.peers.map(p => p.pubkey)))).toEqual(new Set([PEER_ANA, PEER_BEN]))
    // Two pictures on offer is a real choice even when the tile wears none.
    expect(hasPeerImages('sunrise')).toBe(true)
    // A different tile's pictures are not this tile's choices.
    expect(peerImageCandidates('harbor')).toEqual([])
  })

  it('one picture shown by a participant is a choice for a tile that already wears its own', async () => {
    const page = ['wall2']
    seedPage(page, [])
    await goTo(page)
    lifecycle(PEER_ANA)
    announce(page, PEER_ANA, [{ name: 'dune', layerSig: layerSigOf('ana', 'dune'), small: { image: ANA_SMALL } }])
    await until(() => swarm.peerTilesAtCurrentSig().length === 1)
    expect(hasPeerImages('dune')).toBe(false)
    expect(hasPeerImages('dune', true)).toBe(true)
  })

  it('a participant who changes their picture replaces it — the old one is not left on the wall', async () => {
    const page = ['wall3']
    seedPage(page, [])
    await goTo(page)
    lifecycle(PEER_ANA)
    announce(page, PEER_ANA, [{ name: 'cove', layerSig: layerSigOf('ana', 'cove:1'), small: { image: ANA_SMALL } }])
    await until(() => peerImageCandidates('cove').length === 1)

    announce(page, PEER_ANA, [{ name: 'cove', layerSig: layerSigOf('ana', 'cove:2'), small: { image: ANA_NEXT } }])
    await until(() => peerImageCandidates('cove').some(c => c.previewSig === ANA_NEXT))
    expect(peerImageCandidates('cove').map(c => c.previewSig)).toEqual([ANA_NEXT])
  })

  it('a participant whose tile wears a large picture only is still offered', async () => {
    // Wearing a picture from the wall (or a fresh drop before its thumbnails are
    // cut) leaves `large` alone on the tile. It is the participant's picture.
    const page = ['wall4']
    seedPage(page, [])
    await goTo(page)
    lifecycle(PEER_BEN)
    announce(page, PEER_BEN, [{ name: 'ridge', layerSig: layerSigOf('ben', 'ridge'), large: { image: BEN_LARGE, x: 0, y: 0, scale: 1 } }])
    await until(() => swarm.peerTilesAtCurrentSig().length === 1)

    const found = peerImageCandidates('ridge')
    expect(found.map(c => c.previewSig)).toEqual([BEN_LARGE])
    expect(found[0].props.large).toEqual({ image: BEN_LARGE })
  })
})

describe('editing in the swarm shares the new picture', () => {
  it('a saved picture goes out again on the tile\'s page; the new pointers replace the old', async () => {
    const page = ['edit1']
    seedPage(page, ['sunrise'])
    makePublic(page, 'sunrise')
    state.props.set('sunrise', { small: { image: MINE_SMALL } })
    await goTo(page)
    const first = layerAt(page).at(-1)!.payload.visuals!
    expect(first.find(v => v['name'] === 'sunrise')!['small']).toEqual({ image: MINE_SMALL })

    // The editor saves a new picture: the tile's properties and its layer move,
    // and the writer announces `cell:0000-changed`.
    state.props.set('sunrise', { small: { image: MINE_NEXT } })
    state.seal.set([...page, 'sunrise'].join('/'), sha(`seal:${page.join('/')}/sunrise:v2`))
    const before = layerAt(page).length
    EffectBus.emit('cell:0000-changed', { cell: 'sunrise' })
    await until(() => layerAt(page).length > before)

    const latest = layerAt(page).at(-1)!.payload.visuals!
    const sunrise = latest.find(v => v['name'] === 'sunrise')!
    expect(sunrise['small']).toEqual({ image: MINE_NEXT })
    expect(sunrise['layerSig']).toBe(sha(`seal:${page.join('/')}/sunrise:v2`))
  })

  it('a large-only picture (worn from the wall) is published with its pointer', async () => {
    const page = ['edit2']
    seedPage(page, ['tide'])
    makePublic(page, 'tide')
    state.props.set('tide', { large: { image: MINE_NEXT, x: 0, y: 0, scale: 1 } })
    await goTo(page)
    const tide = layerAt(page).at(-1)!.payload.visuals!.find(v => v['name'] === 'tide')!
    expect(tide['large']).toEqual({ image: MINE_NEXT, x: 0, y: 0, scale: 1 })
  })
})
