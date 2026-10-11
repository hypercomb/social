// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.shallow-first.spec.ts — TILE FIRST (D1, BCL-3).
//
// The hunt's GW1 (bigclosure/gatewalk.cjs): one public branch of 5,000 nodes
// and 1,250 pictures, its pool host 80 ms away. The name left in 1.5 s; the
// handle (and the picture) only at 766.5 s, when the LAST atom of the whole
// subtree had been receipted — because the walk announced a full entry only
// once the WHOLE closure was served. A single atom the host never takes made
// it never.
//
// Now a tile is takeable — handle and picture — as soon as its OWN atoms (its
// layer, properties, picture, notes, decorations, meta envelopes) are served
// on its page's hosts. The whole closure is still marked (closure = true), so
// the deeper pages keep uploading; the entry says where they are meanwhile:
// `deep: 'owner'` (only on the sharer's device) until the whole closure
// verifies, then `deep: 'hosted'`.
//
// The live SwarmDrone boots on fake timers against stubbed IoC peers; the
// host-sync stub answers the per-page gate (isClosureAvailableAt) with the
// GW1 timeline: the tile's own atoms are served at TILE_AT, the whole subtree
// at DEEP_AT. A second page answers through closureVerdict, the gate that
// says why (host-sync's standing verdicts).

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { lineageKey } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const HEX64 = /[0-9a-f]{64}/i
const ME = 'a'.repeat(64)
const ROOM = 'downtown'
const SECRET = 'downtown'
const PICTURE = sha('picture:big-branch')

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  public: new Set<string>(),
  // 'location|name' public as a tile alone (not its branch)
  tileOnly: new Set<string>(),
  // sig → when the host serves its own atoms / its whole closure (ms epoch)
  tileAt: new Map<string, number>(),
  deepAt: new Map<string, number>(),
  // closureVerdict answers, by sig and question
  verdicts: new Map<string, Record<string, unknown>>(),
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: (location: string, name: string) => state.public.has(`${location}|${name}`) && !state.tileOnly.has(`${location}|${name}`),
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async (_segments: readonly string[], name: string) => ({ accent: 'amber', small: { image: sha(`picture:${name}`) } }),
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

const sealOf = (path: string): string => sha(`seal:${path}`)
const childSig = (page: string, name: string): string => sha(`child:${page}/${name}`)
const nameByChildSig = new Map<string, string>()
const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) => `loc:${(l.explorerSegments?.() ?? []).join('/')}`,
  currentLayerAt: async (locSig: string) => {
    const kids = state.children.get(locSig.slice(4))
    return kids ? { children: kids.map(n => childSig(locSig.slice(4), n)) } : null
  },
  getLayerBySig: async (sig: string) => ({ name: nameByChildSig.get(sig) }),
  sealSubtree: async (segments: readonly string[]) => sealOf(segments.join('/')),
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => state.segments
  domain = (): string => 'hypercomb.io'
}
const lineage = new FakeLineage()

/** Served at `at` (ms epoch): answered at once after it, held until it before
 *  (a closure walk that waits for the last receipt, like host-sync's). */
const servedAt = (at: number | undefined): Promise<boolean> => {
  if (at === undefined) return Promise.resolve(false)
  const wait = at - Date.now()
  if (wait <= 0) return Promise.resolve(true)
  return new Promise<boolean>(r => setTimeout(() => r(true), wait))
}
const asks: { sig: string; closure: boolean }[] = []
const hostSync: Record<string, unknown> = {
  markPublic: vi.fn(async () => undefined),
  withdrawPublic: vi.fn(),
  isEnabled: () => false,
  isClosureAvailable: vi.fn(async () => false),
  swarmHostsFor: () => ({ hosts: ['pool-a.example'], source: 'pool', pending: false }),
  warmSwarmHosts: () => undefined,
  isClosureAvailableAt: vi.fn((sig: string, _kind: string, closure: boolean) => {
    asks.push({ sig, closure })
    if (state.verdicts.has(`${sig}:${closure}`)) return Promise.resolve(state.verdicts.get(`${sig}:${closure}`)!['ok'] === true)
    return servedAt(closure ? state.deepAt.get(sig) : state.tileAt.get(sig))
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
const layerAt = (segments: readonly string[]): Published[] =>
  published.filter(p => p.kind === 30200 && p.sig === pageSig(segments))
const visualOf = (p: Published, name: string): Record<string, unknown> | undefined =>
  (p.payload.visuals ?? []).find(v => v['name'] === name)
const firstWith = (segments: readonly string[], name: string, pred: (v: Record<string, unknown>) => boolean): Published | undefined =>
  layerAt(segments).find(p => { const v = visualOf(p, name); return !!v && pred(v) })
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

// GW1: the branch is joined into at BOOT; its own atoms are on the pool host
// 2 s later (one tile's worth of uploads at 80 ms), its whole subtree only at
// 766.5 s.
const BRANCH = 'big-branch'
seedPage([], [BRANCH])
const HANDLE = sealOf(BRANCH)
const BOOT = Date.now()
const TILE_AT = BOOT + 2_000
const DEEP_AT = BOOT + 766_500
state.tileAt.set(HANDLE, TILE_AT)
state.deepAt.set(HANDLE, DEEP_AT)

sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

describe('tile first: a branch is takeable once its own atoms are served (BCL-3, D1)', () => {
  it('GW1: the name leaves at once, and the handle and picture follow its own atoms — seconds, not 766 s', async () => {
    await tick(1_000)
    const named = layerAt([]).find(p => visualOf(p, BRANCH))
    expect(named).toBeTruthy()
    expect(named!.at - BOOT).toBeLessThan(1_000)
    // Nothing of it is served yet: a name, no signature anywhere.
    expect(HEX64.test(JSON.stringify(visualOf(named!, BRANCH)))).toBe(false)

    await tick(TILE_AT + 8_000 - Date.now())
    const takeable = firstWith([], BRANCH, v => v['layerSig'] === HANDLE)
    expect(takeable).toBeTruthy()
    const handleAfterMs = takeable!.at - BOOT
    expect(handleAfterMs).toBeLessThan(10_000)                    // today: 766,500 ms
    const v = visualOf(takeable!, BRANCH)!
    expect((v['small'] as { image?: string }).image).toBe(PICTURE) // the picture rides with it
    expect(v['deep']).toBe('owner')                                // its deeper pages: on the sharer's device
    console.info(`[GW1 analog] name ${named!.at - BOOT} ms · handle ${handleAfterMs} ms after join (hunt, before: 1.5 s · 766.5 s)`)
  })

  it('the whole closure keeps uploading — the branch is marked as a closure, not as a tile', () => {
    expect(hostSync['markPublic']).toHaveBeenCalledWith(HANDLE, 'layer', true, [])
  })

  it('while the subtree uploads, every announcement keeps the handle — never a name again', async () => {
    await tick(300_000)
    const since = layerAt([]).filter(p => p.at >= TILE_AT + 1_000)
    expect(since.length).toBeGreaterThan(0)
    for (const p of since) {
      expect(visualOf(p, BRANCH)?.['layerSig']).toBe(HANDLE)
      expect(visualOf(p, BRANCH)?.['deep']).toBe('owner')
    }
  })

  it('when the whole subtree verifies, the entry says so: deep → hosted, within a walk', async () => {
    await tick(DEEP_AT + 1_000 - Date.now())
    const hosted = firstWith([], BRANCH, x => x['deep'] === 'hosted')
    expect(hosted).toBeTruthy()
    expect(hosted!.at - DEEP_AT).toBeLessThan(1_000)
    expect(visualOf(hosted!, BRANCH)!['layerSig']).toBe(HANDLE)
  })

  it('a tile-only public child (not a branch) is full on its own atoms and never carries `deep`', async () => {
    seedPage(['solo'], ['leaf'])
    state.tileOnly.add('/solo|leaf')
    const handle = sealOf('solo/leaf')
    state.tileAt.set(handle, Date.now())
    state.segments = ['solo']
    lineage.dispatchEvent(new Event('change'))
    await tick(1_000)
    const last = layerAt(['solo']).at(-1)!
    expect(visualOf(last, 'leaf')!['layerSig']).toBe(handle)
    expect(visualOf(last, 'leaf')!['deep']).toBeUndefined()
    expect(hostSync['markPublic']).toHaveBeenCalledWith(handle, 'layer', false, ['solo'])
  })
})

describe('the gate that says why (closureVerdict)', () => {
  it('an atom of its OWN the hosts will never take (a 9 MB picture, 413) keeps the tile a name — D1 is "on the host", never "on this device"', async () => {
    seedPage(['photos'], ['holiday'])
    const handle = sealOf('photos/holiday')
    // The boolean gate (what an older swarm asks) says no for good …
    state.verdicts.set(`${handle}:false`, { ok: false })
    state.verdicts.set(`${handle}:true`, { ok: false })
    // … the verdict says why: owner-held, the picture too large for the host.
    hostSync['closureVerdict'] = vi.fn(async (sig: string, _kind: string, deep: boolean) => (sig === handle
      ? { ok: false, ownerHeld: true, blocking: { host: 'pool-a.example', page: ['photos'], sig: sha('picture:holiday'), state: 'too-large', reason: '413 over the 8 MB limit', name: 'holiday', bytes: 9_400_000 } }
      : { ok: !deep, ownerHeld: false }))
    try {
      state.segments = ['photos']
      lineage.dispatchEvent(new Event('change'))
      await tick(1_000)
      const last = layerAt(['photos']).at(-1)!
      const v = visualOf(last, 'holiday')!
      // A take would reach a picture no host holds and no broker answer (8 MB
      // cap) can carry: the tile stays a name, signature-free, until it lands.
      expect(v['layerSig']).toBeUndefined()
      expect(HEX64.test(JSON.stringify(v))).toBe(false)
      expect(v['deep']).toBeUndefined()
    } finally { delete hostSync['closureVerdict'] }
  })

  it('an owner-held DEEPER page leaves the tile takeable — its deeper pages from this device (deep: owner)', async () => {
    seedPage(['albums'], ['summer'])
    const handle = sealOf('albums/summer')
    hostSync['closureVerdict'] = vi.fn(async (sig: string, _kind: string, deep: boolean) => (sig === handle && deep
      ? { ok: false, ownerHeld: true, blocking: { host: 'dead-b.localhost', page: ['albums', 'summer'], sig: sha('child:summer'), state: 'refused', reason: '403 participants-closed' } }
      : { ok: true, ownerHeld: false }))
    try {
      state.segments = ['albums']
      lineage.dispatchEvent(new Event('change'))
      await tick(1_000)
      const v = visualOf(layerAt(['albums']).at(-1)!, 'summer')!
      expect(v['layerSig']).toBe(handle)
      expect(v['deep']).toBe('owner')
    } finally { delete hostSync['closureVerdict'] }
  })
})
