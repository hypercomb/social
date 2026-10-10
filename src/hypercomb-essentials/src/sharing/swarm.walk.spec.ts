// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.walk.spec.ts — THE PAGE SPEAKS FIRST; SLOW WORK ONLY UPGRADES IT.
//
// Live, 2026-10-09 (room 'downtown'): a sharer whose hive held ~6,000 nodes
// joined, beaconed and sent presence every minute, and sent NO page event for
// eleven minutes, until the slowest public closure of its first walk had
// uploaded and verified. The room saw nothing from it all that time. The
// causes, each pinned here on a synthetic hive of the same shape:
//
//   - a page's first walk (no earlier version to say) waited on the host's
//     verdict with no cap;
//   - every child was sealed BEFORE the public filter — thousands of private
//     nodes sealed for a page that shows three tiles;
//   - one walk in flight held every other page's walk behind it;
//   - a public branch whose seal is slow held its whole page.
//
// The live SwarmDrone boots on fake timers against stubbed IoC peers. The host
// serves every public closure only from SERVED_AT_MS on (its upload finishes
// and verifies then); an ask before that waits for it, an ask after it is
// answered at once (host-sync's permanent positive memo).

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const HEX64 = /[0-9a-f]{64}/i
const ME = 'a'.repeat(64)
const ROOM = 'downtown'
const SECRET = 'downtown'

// THE HIVE: three public branches with deep subtrees, beside 24 private
// branches holding 3,120 nodes between them.
const PUBLIC = ['ai-inside', 'bubble-bobble-dos-v1', 'solomon-maze-v1']
const PRIVATE = Array.from({ length: 24 }, (_, i) => `private-${String(i).padStart(2, '0')}`)
const SUBTREE_NODES = new Map<string, number>([
  ['solomon-maze-v1', 3100], ['bubble-bobble-dos-v1', 1603], ['ai-inside', 565],
  ...PRIVATE.map(n => [n, 130] as [string, number]),
])

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  public: new Set<string>(),
  // Every sealSubtree call, by path; and how many nodes each top-level branch
  // made history walk (the seal recurses through the whole subtree).
  sealCalls: [] as string[],
  sealedNodes: new Map<string, number>(),
  sealDelayMs: new Map<string, number>(),
  // Location sigs whose history read never answers.
  hang: new Set<string>(),
  servedAtMs: 0,
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async (_segments: readonly string[], name: string) => ({ accent: 'amber', small: { image: sha(`img:${name}`) } }),
  withoutSubstrateImage: <T>(p: T): T => p,
}))
vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: () => null,
}))

type Published = { kind: number; sig: string; payload: { visuals?: Record<string, unknown>[] } & Record<string, unknown>; at: number }
const published: Published[] = []

const mesh = {
  publish: vi.fn(async (kind: number, sig: string, payload: unknown) => {
    published.push({ kind, sig, payload: JSON.parse(JSON.stringify(payload)), at: Date.now() })
    return true
  }),
  subscribe: vi.fn(() => ({ close: () => undefined })),
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => 'pluginthematrix.com',
  nowSec: () => Math.floor(Date.now() / 1000),
  setNetworkEnabled: vi.fn(),
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

const childSig = (page: string, name: string): string => sha(`child:${page}/${name}`)
const sealOf = (path: string): string => sha(`seal:${path}`)
const nameByChildSig = new Map<string, string>()
const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) => `loc:${(l.explorerSegments?.() ?? []).join('/')}`,
  currentLayerAt: (locSig: string) => {
    if (state.hang.has(locSig)) return new Promise<null>(() => undefined)
    const kids = state.children.get(locSig.slice(4))
    return Promise.resolve(kids ? { children: kids.map(n => childSig(locSig.slice(4), n)) } : null)
  },
  getLayerBySig: async (sig: string) => ({ name: nameByChildSig.get(sig) }),
  sealSubtree: async (segments: readonly string[]) => {
    const path = segments.join('/')
    state.sealCalls.push(path)
    const top = segments[segments.length - 1]
    state.sealedNodes.set(top, (state.sealedNodes.get(top) ?? 0) + (SUBTREE_NODES.get(top) ?? 1))
    const delay = state.sealDelayMs.get(path) ?? 0
    if (delay > 0) await new Promise(r => setTimeout(r, delay))
    return sealOf(path)
  },
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

const verdictAsks: string[] = []
const hostSync = {
  markPublic: vi.fn(async () => undefined),
  withdrawPublic: vi.fn(),
  isClosureAvailable: vi.fn((sig: string) => {
    verdictAsks.push(sig)
    const wait = state.servedAtMs - Date.now()
    if (wait <= 0) return Promise.resolve(true)
    return new Promise<boolean>(r => setTimeout(() => r(true), wait))
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

const seedPage = (segments: string[], names: string[], publicNames: readonly string[] = names): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) nameByChildSig.set(childSig(page, n), n)
  for (const n of publicNames) state.public.add(`/${page}|${n}`)
}
const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${ROOM}\0${SECRET}`)
const CHANNEL = sha(`channel:${ME}\0${ROOM}\0${SECRET}`)
const layerAt = (segments: readonly string[]): Published[] =>
  published.filter(p => p.kind === 30200 && p.sig === pageSig(segments))
const namesOf = (p: Published): string[] => (p.payload.visuals ?? []).map(v => String(v['name'])).sort()
const visual = (p: Published, name: string): Record<string, unknown> =>
  (p.payload.visuals ?? []).find(v => v['name'] === name)!
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }
const go = (segments: string[]): void => { state.segments = segments; lineage.dispatchEvent(new Event('change')) }

// The sharer reloads into the meeting it had joined: standing at the root of
// a large hive, every public closure still uploading.
seedPage([], [...PUBLIC, ...PRIVATE], PUBLIC)
sessionStorage.setItem('hc:mesh-session', 'true')
const BOOT = Date.now()
state.servedAtMs = BOOT + 32_000
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as {
  markDisposed: () => void
  debug: () => Record<string, unknown>
}
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

describe('the page speaks first; slow work only upgrades it', () => {
  it('the first page event leaves at ENTRY_WAIT_MS scale with every public name — names only, none takeable', async () => {
    await tick(1_000)
    const root = layerAt([])
    expect(root.length).toBeGreaterThan(0)
    const first = root[0]
    expect(first.at - BOOT).toBeLessThan(1_000)
    expect(namesOf(first)).toEqual([...PUBLIC].sort())
    for (const v of first.payload.visuals!) {
      expect(v['layerSig']).toBeUndefined()
      expect(HEX64.test(JSON.stringify(v))).toBe(false)
      expect(v['accent']).toBe('amber')            // inert props ride the name
    }
    // Presence went out beside it.
    expect(published.some(p => p.kind === 30204 && p.at - BOOT < 1_000)).toBe(true)
    // Not one private name anywhere on the wire.
    const wire = JSON.stringify(published.map(p => p.payload))
    for (const name of PRIVATE) expect(wire).not.toContain(name)
  })

  it('a private subtree is never sealed — only the public children are', async () => {
    expect(state.sealCalls.filter(p => PRIVATE.includes(p))).toEqual([])
    const privateNodes = PRIVATE.reduce((n, name) => n + (state.sealedNodes.get(name) ?? 0), 0)
    expect(privateNodes).toBe(0)
    for (const name of PUBLIC) expect(state.sealCalls).toContain(name)
  })

  it('the walk says what it did — debug() carries per-page timings, forms and the first announce', async () => {
    const d = swarm.debug() as {
      walks: Record<string, { startedAtMs: number; endedAtMs: number; ms: number; full: number; previous: number; placeholder: number; private: number; outcome: string }>
      firstAnnounce: { page: string; afterJoinMs: number; afterBootMs: number } | null
    }
    const root = d.walks['/']
    expect(root).toBeTruthy()
    expect(root.placeholder).toBe(PUBLIC.length)
    expect(root.full).toBe(0)
    expect(root.private).toBe(PRIVATE.length)
    expect(root.endedAtMs).toBeGreaterThanOrEqual(root.startedAtMs)
    expect(d.firstAnnounce).toBeTruthy()
    expect(d.firstAnnounce!.page).toBe('/')
    expect(d.firstAnnounce!.afterBootMs).toBeLessThan(1_000)
    // Nothing secret in it.
    expect(JSON.stringify(d)).not.toContain(SECRET + '\u0000')
  })

  it('when the verdict lands, the page re-walks to full entries at once — not on the next heartbeat', async () => {
    // The 30 s heartbeat walks while the host is still verifying: still names.
    await tick(30_500 - (Date.now() - BOOT))
    for (const p of layerAt([])) for (const v of p.payload.visuals!) expect(v['layerSig']).toBeUndefined()
    // The host serves them at 32 s.
    await tick(state.servedAtMs + 1_000 - Date.now())
    const last = layerAt([]).at(-1)!
    expect(last.at).toBeGreaterThanOrEqual(state.servedAtMs)
    expect(last.at - state.servedAtMs).toBeLessThan(1_000)
    expect(namesOf(last)).toEqual([...PUBLIC].sort())
    for (const name of PUBLIC) expect(visual(last, name)['layerSig']).toBe(sealOf(name))
    // The personal channel follows the page up — not on the next heartbeat.
    const channel = published.filter(p => p.kind === 30200 && p.sig === CHANNEL)
    expect(channel.length).toBeGreaterThan(0)
    expect(channel[0].at - BOOT).toBeLessThan(1_000)
    for (const p of channel.filter(c => c.at < state.servedAtMs)) {
      for (const v of p.payload.visuals!) expect(v['layerSig']).toBeUndefined()
    }
    const upgraded = channel.find(p => p.at >= state.servedAtMs)!
    expect(upgraded).toBeTruthy()
    expect(upgraded.at - state.servedAtMs).toBeLessThan(1_000)
    for (const name of PUBLIC) expect(visual(upgraded, name)['layerSig']).toBe(sealOf(name))
    // Asked once per closure while it was uploading — the walks that ran
    // meanwhile joined the question in flight instead of stacking new ones.
    for (const name of PUBLIC) {
      const asks = verdictAsks.filter(s => s === sealOf(name)).length
      expect(asks).toBeLessThanOrEqual(3)
    }
  })

  it('a public branch whose seal is slow goes out by name now, and with its handle when the seal lands', async () => {
    seedPage(['arcade'], ['huge', 'small'])
    state.sealDelayMs.set('arcade/huge', 10_000)
    const t0 = Date.now()
    go(['arcade'])
    await tick(1_000)
    const first = layerAt(['arcade'])[0]
    expect(first).toBeTruthy()
    expect(first.at - t0).toBeLessThan(1_000)
    expect(namesOf(first)).toEqual(['huge', 'small'])
    expect(visual(first, 'small')['layerSig']).toBe(sealOf('arcade/small'))   // served: full
    expect(visual(first, 'huge')['layerSig']).toBeUndefined()                // its seal is still running
    await tick(10_000)
    const last = layerAt(['arcade']).at(-1)!
    expect(last.at - t0).toBeLessThan(11_500)
    expect(visual(last, 'huge')['layerSig']).toBe(sealOf('arcade/huge'))
  })

  it('a page whose walk never finishes holds no other page — the next page speaks within a second', async () => {
    seedPage(['vault'], ['v1'])
    seedPage(['open'], ['o1', 'o2'])
    state.hang.add('loc:vault')
    go(['vault'])
    await tick(200)
    expect(layerAt(['vault'])).toEqual([])       // history cannot say: nothing said
    const t0 = Date.now()
    go(['open'])
    await tick(1_000)
    const open = layerAt(['open'])
    expect(open.length).toBeGreaterThan(0)
    expect(open[0].at - t0).toBeLessThan(1_000)
    expect(namesOf(open[0])).toEqual(['o1', 'o2'])
    // And presence followed the participant there.
    expect(published.some(p => p.kind === 30204 && p.at >= t0 && p.at - t0 < 1_000)).toBe(true)
  })

  it('a branch made private is withdrawn by the handle the walk marked, without sealing it again', async () => {
    seedPage(['shop'], ['till'])
    go(['shop'])
    await tick(1_000)
    expect(hostSync.markPublic).toHaveBeenCalledWith(sealOf('shop/till'), 'layer', true, ['shop'])
    const sealsBefore = state.sealCalls.filter(p => p === 'shop/till').length
    state.public.delete('/shop|till')
    EffectBus.emit('tile:public-changed', { cell: 'till', location: '/shop', public: false })
    await tick(1_000)
    expect(hostSync.withdrawPublic).toHaveBeenCalledWith(sealOf('shop/till'))
    expect(state.sealCalls.filter(p => p === 'shop/till').length).toBe(sealsBefore)
    expect(namesOf(layerAt(['shop']).at(-1)!)).toEqual([])
  })
})
