// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.nav-frames.spec.ts — FEWER FRAMES PER NAVIGATION (LS-2).
//
// The hunt's LS-kinds-1800 (diag/long-kinds.cjs): one explorer walking a
// sharer's tree at 1.8 s per page spent 7.4 EVENT + 1.45 REQ per navigation
// (30200 ×3.0, 20400 ×2.1, 30203 ×1.1, 30204 ×1.1) against the relay's 10
// frames/s budget, and at 2.5 pages/s (LS-kinds-400) its drills, page slots
// and presence came back 'rate-limited' after ~41 s. Per arrival it sent:
//   - the late-joiner visuals ask (EVENT + REQ + CLOSE), though the
//     publisher's drill answer was about to fill the page anyway;
//   - its personal channel's word, the same empty layer page after page;
//   - and on every heartbeat, an empty layer at every foreign page it had
//     ever walked through (sticky mode), ~1 frame/s by 64 pages.
//
// Now: the ask waits RECOVERY_WAIT_MS for the page's own replay or the drill
// answer; the channel says only a word that changed, once the move settles;
// a page where the explorer holds nothing is never re-announced.
//
// The live SwarmDrone runs on fake timers against stubbed IoC peers. A
// sharer's answers are simulated: every drill gets that page's layer 300 ms
// later, like a sharer on a warm socket. Frames counted are this tab's own:
// EVENTs (mesh.publish), REQs (mesh.subscribe), CLOSEs, and each broker
// visuals ask as the EVENT + REQ + CLOSE it is on the wire.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const SHARER = 'b'.repeat(64)
const SIGNED = 'f'.repeat(128)
const ROOM = 'meetup'
const SECRET = '4417'

const state = vi.hoisted(() => ({ segments: [] as string[] }))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: () => false,
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

const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${ROOM}\0${SECRET}`)
const LIFE = sha(`lifecycle\0${ROOM}\0${SECRET}`)
const nowSec = (): number => Math.floor(Date.now() / 1000)

// The sharer's tree: root → p0..p119 → one leaf each.
const PAGES = Array.from({ length: 120 }, (_, i) => `p${i}`)

type Frame = { at: number; what: string }
const frames: Frame[] = []
type MeshEvt = { relay: string; sig: string; event: Record<string, unknown>; payload: unknown }
const subs = new Map<string, Set<(e: MeshEvt) => void>>()
const deliver = (sig: string, event: Record<string, unknown>, payload: unknown): void => {
  for (const cb of [...(subs.get(sig) ?? [])]) cb({ relay: 'wss://relay', sig, event, payload })
}
const sharerSays = (segments: readonly string[]): void => {
  const sig = pageSig(segments)
  const at = nowSec()
  const visuals = segments.length === 0 ? PAGES.map(name => ({ name })) : [{ name: `leaf-of-${segments.join('-')}` }]
  deliver(sig, { kind: 30200, pubkey: SHARER, created_at: at, sig: SIGNED, tags: [['d', sig], ['expiration', String(at + 90)]] }, { visuals })
}
const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown) => {
    frames.push({ at: Date.now(), what: `EVENT ${kind}` })
    // The sharer answers a drill with that page, 300 ms later.
    const path = (payload as { pathSegments?: unknown })?.pathSegments
    if (kind === 30203 && sig === LIFE && Array.isArray(path)) setTimeout(() => sharerSays(path as string[]), 300)
    return true
  }),
  subscribe: vi.fn((sig: string, cb: (e: MeshEvt) => void) => {
    frames.push({ at: Date.now(), what: 'REQ' })
    let set = subs.get(sig)
    if (!set) { set = new Set(); subs.set(sig, set) }
    set.add(cb)
    // The relay replays what it holds for the page: the sharer's slot, while
    // it is fresh (the sharer re-says a page only when drilled, like a
    // sharer standing elsewhere).
    return { close: () => { frames.push({ at: Date.now(), what: 'CLOSE' }); set!.delete(cb) } }
  }),
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => 'relay',
  nowSec,
  setNetworkEnabled: () => undefined,
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) => `loc:${(l.explorerSegments?.() ?? []).join('/')}`,
  // The explorer holds nothing anywhere in the sharer's tree.
  currentLayerAt: async () => null,
  getLayerBySig: async () => null,
  sealSubtree: async () => null,
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

const broker = {
  notePeerLiveness: () => undefined,
  noteDomainsForSig: () => undefined,
  fetchVisualsAt: vi.fn(async () => {
    frames.push({ at: Date.now(), what: 'EVENT 20400' }, { at: Date.now(), what: 'REQ' }, { at: Date.now(), what: 'CLOSE' })
    return []
  }),
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
  '@diamondcoreprocessor.com/HostSyncService': { markPublic: async () => undefined, isClosureAvailable: async () => true, isEnabled: () => false },
  '@diamondcoreprocessor.com/ContentBrokerDrone': broker,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

// The sharer is in the room and its root is in the relay.
const beaconSharer = (): void => {
  const at = nowSec()
  deliver(LIFE, { kind: 30206, pubkey: SHARER, created_at: at, sig: SIGNED, tags: [['d', SHARER], ['expiration', String(at + 90)]] }, { alive: true, v: 2 })
}
await tick(500)
beaconSharer()
sharerSays([])
await tick(2_000)

/** Walk `navs` navigations at `stepMs` each — into a page, back to root, into
 *  the next one: every page entered from its parent. Returns the frames this
 *  tab sent over the walk (and the second after it). */
const walk = async (pages: readonly string[], navs: number, stepMs: number): Promise<Frame[]> => {
  const from = frames.length
  let n = 0
  for (const page of pages) {
    for (const segments of [[page], []]) {
      if (n >= navs) break
      // The sharer keeps its root slot alive (its own heartbeat).
      if (segments.length === 0 && n % 20 === 0) { beaconSharer(); sharerSays([]) }
      state.segments = segments
      lineage.dispatchEvent(new Event('change'))
      await tick(stepMs)
      n++
    }
    if (n >= navs) break
  }
  await tick(1_000)
  return frames.slice(from)
}
const kinds = (fs: readonly Frame[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const f of fs) out[f.what] = (out[f.what] ?? 0) + 1
  return out
}
/** The relay's per-connection token bucket (relay.js: CONN_BURST 400,
 *  CONN_REFILL_PER_SEC 10): how many of these frames it would refuse. */
const refusedByBucket = (fs: readonly Frame[], startTokens = 400): number => {
  let tokens = startTokens
  let last = fs[0]?.at ?? 0
  let refused = 0
  for (const f of fs) {
    tokens = Math.min(400, tokens + (f.at - last) / 100)
    last = f.at
    if (tokens >= 1) tokens -= 1
    else refused++
  }
  return refused
}

describe('frames per navigation (LS-2)', () => {
  it('LS-kinds-1800: 40 navigations at 1.8 s — at most 5 frames each (EVENT + REQ)', async () => {
    const asksBefore = broker.fetchVisualsAt.mock.calls.length   // the join's own ask (at once, as ever)
    const fs = await walk(PAGES.slice(0, 20), 40, 1_800)
    const k = kinds(fs)
    const events = fs.filter(f => f.what.startsWith('EVENT')).length
    const reqs = k['REQ'] ?? 0
    const perNav = (events + reqs) / 40
    console.info(`[LS-kinds-1800 analog] ${events} EVENT + ${reqs} REQ over 40 navs = ${perNav.toFixed(2)}/nav · ${JSON.stringify(k)} (hunt, before: 7.4 EVENT + 1.45 REQ = 8.7/nav)`)
    expect(perNav).toBeLessThanOrEqual(5)
    // No late-joiner ask on any move: the drill answer always came first.
    expect(broker.fetchVisualsAt.mock.calls.length).toBe(asksBefore)
  })

  it('a heartbeat re-announces none of the foreign pages walked through', async () => {
    const from = frames.length
    await tick(65_000)                               // two heartbeats, standing at root
    const layers = frames.slice(from).filter(f => f.what === 'EVENT 30200').length
    console.info(`[sticky analog] 30200 frames over two heartbeats after a 40-page walk: ${layers}`)
    // Only this page's own slot (and the personal channel) — never 20 empty layers.
    expect(layers).toBeLessThanOrEqual(4)
  })

  it('LS-kinds-400: 120 navigations at 400 ms — nothing the relay\'s bucket would refuse', async () => {
    const fs = await walk(PAGES.slice(20, 80), 120, 400)
    const all = fs.length
    const refused = refusedByBucket(fs)
    const events = fs.filter(f => f.what.startsWith('EVENT')).length
    console.info(`[LS-kinds-400 analog] ${all} frames (${events} EVENT) over 120 navs in ${(120 * 0.4 + 1).toFixed(1)} s · bucket refusals ${refused} (hunt, before: 965 frames, first 'rate-limited' at ~41 s, 79 refused in the last 8 s)`)
    expect(refused).toBe(0)
  })
})

void EffectBus
