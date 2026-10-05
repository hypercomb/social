// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm-reload-cold.spec.ts — A COLD HISTORY READ IS "UNKNOWN", NEVER
// "EMPTY" (swarm.drone.ts #knownLayerAt).
//
// A reloaded tab resumes its swarm membership before its history is warm: the
// first walk asks for the root layer while the store root is still coming up,
// and history answers a TRANSIENT null (stats.cold). Read as "no layer", that
// null fell back to an OPFS listing that does not exist and went out as
// {visuals: []} — the relay replaced the sharer's slot with nothing and every
// peer standing on the page dropped its tiles until a later walk restored them.
//
// The live SwarmDrone boots on fake timers against stubbed IoC peers. The
// history stub answers cold while `state.cold` holds (the store root is not
// ready), and per location while `state.coldReads` has a count for it (a head
// whose bytes are still landing).

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { lineageKey } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const ROOM = 'meetup'
const SECRET = '4417'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  public: new Set<string>(),
  // The whole history is cold — the store root is not ready yet.
  cold: true,
  // 'loc:<page>' → reads still to answer cold (a head whose bytes are landing).
  coldReads: new Map<string, number>(),
  reads: 0,
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
  currentLayerAt: async (locSig: string, stats?: { cold?: boolean }) => {
    state.reads++
    const pending = state.coldReads.get(locSig) ?? 0
    if (state.cold || pending > 0) {
      if (pending > 0) state.coldReads.set(locSig, pending - 1)
      if (stats) stats.cold = true
      return null
    }
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
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
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

/** Put `names` at page `segments`, every one public. */
const seedPage = (segments: string[], names: string[]): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) {
    nameByChildSig.set(childSig(page, n), n)
    state.public.add(`/${page}|${n}`)
  }
}
const pageSig = (segments: readonly string[]): string => sha(`${lineageKey(segments)}\0${ROOM}\0${SECRET}`)
const CHANNEL = sha(`channel:${ME}\0${ROOM}\0${SECRET}`)
const layerAt = (segments: readonly string[]): Published[] =>
  published.filter(p => p.kind === 30200 && p.sig === pageSig(segments))
const namesOf = (p: Published): string[] => (p.payload.visuals ?? []).map(v => String(v['name'])).sort()
const emptyLayers = (): Published[] =>
  published.filter(p => p.kind === 30200 && (p.payload.visuals ?? []).length === 0)
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

// The reloaded tab: joined (the session survives a reload), standing at the
// root, its history not warm yet.
seedPage([], ['alpha', 'beta'])
sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

describe('a cold history read is unknown, never empty', () => {
  it('a history that stays cold past the wait says nothing at all — no empty page, no empty channel', async () => {
    await tick(6_000)
    expect(state.reads).toBeGreaterThan(0)            // the walk did ask
    expect(layerAt([])).toEqual([])                   // and announced nothing for the page
    expect(emptyLayers()).toEqual([])                 // nor an empty slot anywhere, the channel included
  })

  it("a reload's walk waits out the cold window and announces the full page — never an empty one first", async () => {
    // Still cold: a navigation (the URL restore) walks again and keeps asking.
    lineage.dispatchEvent(new Event('change'))
    await tick(150)
    expect(layerAt([])).toEqual([])
    state.cold = false                                // the store root is up
    await tick(200)
    const root = layerAt([])
    expect(root.length).toBeGreaterThan(0)
    for (const p of root) expect(namesOf(p)).toEqual(['alpha', 'beta'])
    const channel = published.filter(p => p.kind === 30200 && p.sig === CHANNEL)
    expect(channel.length).toBeGreaterThan(0)
    for (const p of channel) expect(namesOf(p)).toEqual(['alpha', 'beta'])
    expect(emptyLayers()).toEqual([])
  })

  it('once history is warm, a page whose head bytes are still landing is skipped at once — it neither empties nor stalls the walk', async () => {
    seedPage(['rl'], ['gamma'])
    seedPage(['ok'], ['delta'])
    state.coldReads.set('loc:rl', 1e9)                // cold for as long as this test runs
    state.segments = ['rl']
    lineage.dispatchEvent(new Event('change'))
    await tick(50)
    expect(layerAt(['rl'])).toEqual([])               // unknown: nothing said for the page

    // The very next page goes out at once — the cold page held nothing up
    // (a 5 s per-read wait inside the walk would have queued it behind).
    const t0 = Date.now()
    state.segments = ['ok']
    lineage.dispatchEvent(new Event('change'))
    await tick(50)
    const ok = layerAt(['ok'])
    expect(ok.length).toBeGreaterThan(0)
    expect(ok[0].at - t0).toBeLessThan(100)
    expect(namesOf(ok[0])).toEqual(['delta'])

    // The bytes land: the next walk of the page announces it in full.
    state.coldReads.delete('loc:rl')
    state.segments = ['rl']
    lineage.dispatchEvent(new Event('change'))
    await tick(50)
    const rl = layerAt(['rl'])
    expect(rl.length).toBeGreaterThan(0)
    for (const p of rl) expect(namesOf(p)).toEqual(['gamma'])
    expect(emptyLayers()).toEqual([])
  })
})
