// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.seal-replay.spec.ts — A SLOW SEAL REFUSAL NEVER LOOPS (BCL-6),
// AND A WALK NEVER OPENS A SUBSCRIPTION OF ITS OWN (LS-1).
//
// BCL-6 — the hunt's SH1 (bigclosure/sealhole.cjs): one layer under a public
// root held nowhere. history.sealSubtree refused it, slowly (>250 ms, past
// SEAL_WAIT_MS), so the walk offered the child with NO handle, and when the
// refusal landed it walked again — which sealed again, which refused again:
// 141 refusals and 213 GET 404s for the missing sigs in 242 s, and the tile
// never takeable. Now a refusal settles on the raw handle (as a refusal
// inside the wait already did) and re-walks only when what it settles on
// differs from what the walk offered.
//
// LS-1 — the hunt's LS-drill3/4/5 (diag/long-drill*.cjs): a sharer that has
// reloaded once (RESUMED_AT_LOAD) answered every peer's drill by walking that
// page, and the walk waited for "our own replay" there — the mesh opened a
// bucket with no consumer and a live REQ per drilled page, closed by nothing.
// After ~190 drilled pages the relay refused new subscriptions and the sharer
// was deaf at every page it walked into. Now only the page this tab stands on
// (subscribed) waits for its replay; every other walk reads what the mesh
// already holds.
//
// The live SwarmDrone boots RESUMED on fake timers against stubbed IoC peers;
// the mesh stub models buckets the way nostr-mesh.drone.ts keeps them.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { lineageKey } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const PEER = 'b'.repeat(64)
const SIGNED = 'f'.repeat(128)
const ROOM = 'downtown'
const SECRET = 'downtown'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  public: new Set<string>(),
  sealCalls: [] as string[],
  // path → [delay ms, result]
  seal: new Map<string, [number, string | null]>(),
}))

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

// THE MESH'S BUCKETS: one per sig, with its consumers. A bucket opened by
// awaitReadyForSig with no consumer is what LS-1 leaked (ensureStartedForSig,
// closed only from unsubscribe).
type MeshEvt = { relay: string; sig: string; event: Record<string, unknown>; payload: unknown }
const consumers = new Map<string, Set<(e: MeshEvt) => void>>()
const buckets = new Set<string>()
const awaitedFor: string[] = []
type Published = { kind: number; sig: string; payload: { visuals?: Record<string, unknown>[] } & Record<string, unknown>; at: number }
const published: Published[] = []
const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown) => {
    published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), at: Date.now() })
    return true
  }),
  subscribe: vi.fn((sig: string, cb: (e: MeshEvt) => void) => {
    let set = consumers.get(sig)
    if (!set) { set = new Set(); consumers.set(sig, set) }
    set.add(cb)
    buckets.add(sig)
    return { close: () => { set!.delete(cb); if (set!.size === 0) { consumers.delete(sig); buckets.delete(sig) } } }
  }),
  awaitReadyForSig: vi.fn((sig: string, timeoutMs = 600) => {
    awaitedFor.push(sig)
    buckets.add(sig)                       // ensureStartedForSig: a bucket and its REQ
    return new Promise<void>(r => setTimeout(r, Math.min(timeoutMs, 40)))
  }),
  getNonExpired: vi.fn(() => []),
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
  sealSubtree: async (segments: readonly string[]) => {
    const path = segments.join('/')
    state.sealCalls.push(path)
    const [delay, result] = state.seal.get(path) ?? [0, sha(`seal:${path}`)]
    if (delay > 0) await new Promise(r => setTimeout(r, delay))
    return result
  },
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

const hostSync = {
  markPublic: vi.fn(async () => undefined),
  withdrawPublic: vi.fn(),
  // The tile's own atoms are served (its raw handle and the sealed ones).
  isClosureAvailable: vi.fn(async (_sig: string, _kind?: string, closure = true) => !closure),
  isEnabled: () => false,
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
  '@diamondcoreprocessor.com/HostSyncService': hostSync,
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
const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${ROOM}\0${SECRET}`)
const LIFE = sha(`lifecycle\0${ROOM}\0${SECRET}`)
const deliver = (sig: string, event: Record<string, unknown>, payload: unknown): void => {
  for (const cb of [...(consumers.get(sig) ?? [])]) cb({ relay: 'wss://jwize.com', sig, event, payload })
}
const layerAt = (segments: readonly string[]): Published[] =>
  published.filter(p => p.kind === 30200 && p.sig === pageSig(segments))
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

// The sharer's root: `hole-small` (a layer under it held nowhere — its seal
// refuses after 400 ms) beside `ok-small`. 200 public pages for explorers.
seedPage([], ['hole-small', 'ok-small'])
state.seal.set('hole-small', [400, null])
const DRILLED = 200
for (let i = 0; i < DRILLED; i++) seedPage([`pub-${i}`], [`leaf-${i}`])
for (let i = 0; i < DRILLED; i++) state.public.add(`/|pub-${i}`)

// A reloaded tab, still in the zone it was in (RESUMED_AT_LOAD).
sessionStorage.setItem('hc:mesh-session', 'true')
const BOOT = Date.now()
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

describe('a slow seal refusal (BCL-6, SH1)', () => {
  it('the child goes out WITH its raw handle by the second walk — takeable on its own atoms, never handle-less for ever', async () => {
    await tick(2_000)
    const withHandle = layerAt([]).find(p => (p.payload.visuals ?? []).some(v => v['name'] === 'hole-small' && v['layerSig'] === childSig('', 'hole-small')))
    expect(withHandle).toBeTruthy()
    expect(withHandle!.at - BOOT).toBeLessThan(2_000)
    // The raw handle reaches markPublic, so host-sync can name the hole.
    expect(hostSync.markPublic).toHaveBeenCalledWith(childSig('', 'hole-small'), 'layer', true, [])
  })

  it('240 s of a sitting sharer: the refusal is asked on the heartbeat, not ~2/s in a loop', async () => {
    await tick(BOOT + 242_000 - Date.now())
    const refusals = state.sealCalls.filter(p => p === 'hole-small').length
    console.info(`[SH1 analog] sealSubtree('hole-small') refusals in 242 s: ${refusals} (hunt, before: 141 refusals + 213 GET 404)`)
    // Heartbeat (30 s) and the join's fast retry (3 s for 20 s) walks only.
    expect(refusals).toBeLessThanOrEqual(20)
    // And it stayed takeable on every page event since.
    const late = layerAt([]).filter(p => p.at > BOOT + 5_000)
    expect(late.length).toBeGreaterThan(0)
    for (const p of late) {
      const v = (p.payload.visuals ?? []).find(x => x['name'] === 'hole-small')
      expect(v?.['layerSig']).toBe(childSig('', 'hole-small'))
    }
  })
})

describe('a resumed sharer answering drills (LS-1)', () => {
  it('the page this tab stands on still waits for its own replay — the reload keeps what it said', () => {
    expect(awaitedFor).toContain(pageSig([]))
  })

  it(`${DRILLED} drilled pages open NO subscription — zero-consumer buckets stay at 0 (today: one per page, deaf at 200)`, async () => {
    const before = new Set(awaitedFor)
    for (let i = 0; i < DRILLED; i++) {
      const at = Math.floor(Date.now() / 1000)
      deliver(LIFE, { kind: 30203, pubkey: PEER, created_at: at, sig: SIGNED, tags: [['d', `drill:${PEER}`], ['expiration', String(at + 90)]] },
        { pathSegments: [`pub-${i}`] })
      await tick(200)
    }
    await tick(2_000)
    // Every drill was answered with that page's layer …
    let answered = 0
    for (let i = 0; i < DRILLED; i++) if (layerAt([`pub-${i}`]).length > 0) answered++
    expect(answered).toBe(DRILLED)
    // … and not one of them waited on a replay that needs a subscription.
    const newWaits = awaitedFor.filter(s => !before.has(s))
    const zeroConsumer = [...buckets].filter(s => !consumers.has(s))
    console.info(`[LS-drill analog] ${DRILLED} drill answers: awaitReadyForSig ${newWaits.length}, zero-consumer buckets ${zeroConsumer.length} (hunt LS-drill5, before: 203 buckets, cap at 200)`)
    expect(newWaits.length).toBe(0)
    expect(zeroConsumer.length).toBe(0)
    expect(mesh.getNonExpired).toHaveBeenCalled()         // what the mesh holds is still read
  })
})
