// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.walk-reload.spec.ts — A RELOAD NEVER TAKES BACK WHAT IT SAID.
//
// A page's first walk after a reload has no earlier version of its own in
// memory, and it no longer waits on the host's verdict without a cap (see
// swarm.walk.spec.ts) — so with nothing more, every tile the sharer had
// announced in full would go out again as a bare name until the host
// answered: a takeable tile turned back into a label for the whole room.
//
// The relay still holds what this sharer said there last, and replays it to
// the page subscription the walk opens. Our OWN replayed entries are the
// earlier version: re-announced while their handle is still served (the same
// re-ask an in-memory earlier version gets), never when it is not, never for
// a tile that is gone or private now, and never when the signature is not
// ours — a relay cannot put words in our mouth.
//
// The live SwarmDrone boots on fake timers against stubbed IoC peers. The
// mesh stub replays the relay's stored events to a new page subscription a
// moment after it opens, like a REQ answered over a warm socket.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { lineageKey } from '@hypercomb/core'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const HEX64 = /[0-9a-f]{64}/i
const SK = generateSecretKey()
const ME = getPublicKey(SK)
const PEER_SK = generateSecretKey()
const ROOM = 'downtown'
const SECRET = 'downtown'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  public: new Set<string>(),
  seal: new Map<string, string>(),
  // sig → when the host answers, and what.
  answers: new Map<string, { atMs: number; ok: boolean }>(),
  asked: [] as string[],
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async (_segments: readonly string[], name: string) => ({ accent: `now-${name}` }),
  withoutSubstrateImage: <T>(p: T): T => p,
}))
vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: () => null,
}))

const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${ROOM}\0${SECRET}`)
const ROOT = pageSig([])

type Published = { kind: number; sig: string; payload: { visuals?: Record<string, unknown>[] } & Record<string, unknown>; at: number }
const published: Published[] = []
type Delivered = { relay: string; sig: string; event: Record<string, unknown>; payload: unknown }

// What the relay holds at the root page, replayed to a new subscription.
const stored: Delivered[] = []
// A page whose replay is slow (a socket still dialling): delivered this long
// after the subscription opens — past the walk's wait.
const lateReplays = new Map<string, { event: Delivered; afterMs: number }>()
const readyWaiters = new Map<string, (() => void)[]>()
const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown) => {
    published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), at: Date.now() })
    return true
  }),
  subscribe: vi.fn((sig: string, cb: (e: Delivered) => void) => {
    const late = lateReplays.get(sig)
    if (late) setTimeout(() => cb(late.event), late.afterMs)
    if (sig === ROOT) {
      // A peer's slot first, then ours a frame behind — one REQ's replay.
      stored.forEach((e, i) => setTimeout(() => {
        cb(e)
        const waiting = readyWaiters.get(sig) ?? []
        readyWaiters.delete(sig)
        for (const w of waiting) w()
      }, 40 + i * 5))
    }
    return { close: () => undefined }
  }),
  awaitReadyForSig: (sig: string, timeoutMs = 900) => new Promise<void>(resolve => {
    const list = readyWaiters.get(sig) ?? []
    list.push(resolve)
    readyWaiters.set(sig, list)
    setTimeout(resolve, timeoutMs)
  }),
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => 'pluginthematrix.com',
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
  withdrawPublic: vi.fn(),
  isClosureAvailable: vi.fn((sig: string) => {
    state.asked.push(sig)
    const a = state.answers.get(sig) ?? { atMs: 0, ok: false }
    const wait = a.atMs - Date.now()
    if (wait <= 0) return Promise.resolve(a.ok)
    return new Promise<boolean>(r => setTimeout(() => r(a.ok), wait))
  }),
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

const v = (tag: string): string => sha(tag)
// The hive now: maze unchanged, bubble edited since the last announce, ai new,
// cat edited while its old version left the host, priv made private, gone
// deleted.
const NOW = { maze: v('maze:v1'), bubble: v('bubble:v2'), ai: v('ai:v1'), cat: v('cat:v2'), priv: v('priv:v1') }
for (const [name, sig] of Object.entries(NOW)) state.seal.set(name, sig)
state.children.set('', ['ai', 'bubble', 'cat', 'maze', 'priv'])
for (const name of ['ai', 'bubble', 'cat', 'maze', 'priv']) nameByChildSig.set(childSig('', name), name)
for (const name of ['ai', 'bubble', 'cat', 'maze']) state.public.add(`/|${name}`)

const BOOT = Date.now()
const SERVED_AT = BOOT + 32_000
// The host: maze's handle verifies again only at 32 s (a slow re-check after
// the reload); bubble's earlier handle is served (a quick yes); cat's earlier
// handle is gone (a quick no); the new handles finish uploading at 32 s.
state.answers.set(NOW.maze, { atMs: SERVED_AT, ok: true })
state.answers.set(v('bubble:v1'), { atMs: BOOT + 20, ok: true })
state.answers.set(v('cat:v1'), { atMs: BOOT + 20, ok: false })
state.answers.set(NOW.bubble, { atMs: SERVED_AT, ok: true })
state.answers.set(NOW.ai, { atMs: SERVED_AT, ok: true })
state.answers.set(NOW.cat, { atMs: SERVED_AT, ok: true })
state.answers.set(v('forged'), { atMs: 0, ok: true })

// What this sharer said at the root twenty seconds before the reload.
const nowSec = Math.floor(BOOT / 1000)
const said = {
  maze: { accent: 'then-maze', layerSig: NOW.maze, name: 'maze' },
  bubble: { accent: 'then-bubble', layerSig: v('bubble:v1'), name: 'bubble' },
  cat: { accent: 'then-cat', layerSig: v('cat:v1'), name: 'cat' },
  priv: { accent: 'then-priv', layerSig: v('priv:v0'), name: 'priv' },
  gone: { accent: 'then-gone', layerSig: v('gone:v1'), name: 'gone' },
}
const ours = finalizeEvent({
  kind: 30200,
  created_at: nowSec - 20,
  tags: [['x', ROOT], ['d', ROOT], ['expiration', String(nowSec + 70)], ['domain', 'hypercomb.com']],
  content: JSON.stringify({ visuals: Object.values(said) }),
}, SK)
// A relay forging our word: newer, our pubkey, a signature that is not ours.
const forged = { ...finalizeEvent({
  kind: 30200,
  created_at: nowSec - 5,
  tags: [['x', ROOT], ['d', ROOT], ['expiration', String(nowSec + 85)]],
  content: JSON.stringify({ visuals: [{ name: 'ai', layerSig: v('forged'), accent: 'forged' }] }),
}, PEER_SK), pubkey: ME }
const peer = finalizeEvent({
  kind: 30200,
  created_at: nowSec - 10,
  tags: [['x', ROOT], ['d', ROOT], ['expiration', String(nowSec + 80)]],
  content: JSON.stringify({ visuals: [{ name: 'their-tile' }] }),
}, PEER_SK)
// Through the wire: JSON, as a relay frame arrives (no cached verdict rides
// along on the object).
for (const e of [peer, ours, forged]) {
  const wire = JSON.parse(JSON.stringify(e)) as Record<string, unknown>
  stored.push({ relay: 'wss://pluginthematrix.com', sig: ROOT, event: wire, payload: JSON.parse(e.content) })
}

const layerAt = (segments: readonly string[]): Published[] =>
  published.filter(p => p.kind === 30200 && p.sig === pageSig(segments))
const namesOf = (p: Published): string[] => (p.payload.visuals ?? []).map(x => String(x['name'])).sort()
const visual = (p: Published, name: string): Record<string, unknown> =>
  (p.payload.visuals ?? []).find(x => x['name'] === name)!
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

describe('a reload re-announces its own replayed entries while they are served', () => {
  it('the first page event after the reload carries the earlier full entries — no placeholder downgrade', async () => {
    await tick(1_000)
    const root = layerAt([])
    expect(root.length).toBeGreaterThan(0)
    const first = root[0]
    expect(first.at - BOOT).toBeLessThan(1_000)
    expect(namesOf(first)).toEqual(['ai', 'bubble', 'cat', 'maze'])
    // Served (or still being re-checked): said again, byte for byte.
    expect(visual(first, 'maze')).toEqual(said.maze)
    expect(visual(first, 'bubble')).toEqual(said.bubble)
    // Its earlier handle is gone from the host: a name, never a dead handle.
    expect(visual(first, 'cat')['layerSig']).toBeUndefined()
    expect(HEX64.test(JSON.stringify(visual(first, 'cat')))).toBe(false)
    // Never said before: a name. The forged word under our key is not ours.
    expect(visual(first, 'ai')['layerSig']).toBeUndefined()
    expect(JSON.stringify(published.map(p => p.payload))).not.toContain('forged')
    expect(state.asked).not.toContain(v('forged'))
    // Private now, or deleted: never announced, whatever the relay held.
    const wire = JSON.stringify(published.map(p => p.payload))
    expect(wire).not.toContain('priv')
    expect(wire).not.toContain('gone')
  })

  it('every page event until the host answers keeps the full entries — and then it upgrades to the new handles', async () => {
    await tick(SERVED_AT + 1_000 - Date.now())
    const before = layerAt([]).filter(p => p.at < SERVED_AT)
    expect(before.length).toBeGreaterThan(0)
    for (const p of before) {
      expect(visual(p, 'maze')['layerSig']).toBe(NOW.maze)
      expect(visual(p, 'bubble')['layerSig']).toBe(v('bubble:v1'))
    }
    const last = layerAt([]).at(-1)!
    expect(last.at - SERVED_AT).toBeLessThan(1_000)
    expect(visual(last, 'maze')).toMatchObject({ layerSig: NOW.maze, accent: 'now-maze' })
    expect(visual(last, 'bubble')).toMatchObject({ layerSig: NOW.bubble, accent: 'now-bubble' })
    expect(visual(last, 'cat')['layerSig']).toBe(NOW.cat)
    expect(visual(last, 'ai')['layerSig']).toBe(NOW.ai)
  })

  it('a replay that lands after the first walk turns its names back into what was said — within a re-walk', async () => {
    const page = ['late']
    const sig = pageSig(page)
    state.children.set('late', ['kite'])
    nameByChildSig.set(childSig('late', 'kite'), 'kite')
    state.public.add('/late|kite')
    state.seal.set('late/kite', v('kite:v2'))
    state.answers.set(v('kite:v2'), { atMs: Date.now() + 60_000, ok: true })
    state.answers.set(v('kite:v1'), { atMs: 0, ok: true })
    const t = Math.floor(Date.now() / 1000)
    const saidKite = { accent: 'then-kite', layerSig: v('kite:v1'), name: 'kite' }
    const ev = JSON.parse(JSON.stringify(finalizeEvent({
      kind: 30200,
      created_at: t - 30,
      tags: [['x', sig], ['d', sig], ['expiration', String(t + 60)]],
      content: JSON.stringify({ visuals: [saidKite] }),
    }, SK))) as Record<string, unknown>
    lateReplays.set(sig, { event: { relay: 'wss://pluginthematrix.com', sig, event: ev, payload: { visuals: [saidKite] } }, afterMs: 2_000 })

    const t0 = Date.now()
    state.segments = page
    lineage.dispatchEvent(new Event('change'))
    await tick(1_000)
    const first = layerAt(page)[0]
    expect(first).toBeTruthy()
    expect(first.at - t0).toBeLessThan(1_000)
    expect(visual(first, 'kite')['layerSig']).toBeUndefined()   // nothing known yet: the name

    await tick(1_500)
    const restored = layerAt(page).at(-1)!
    expect(restored.at - t0).toBeLessThan(2_500)
    expect(visual(restored, 'kite')).toEqual(saidKite)
  })
})
