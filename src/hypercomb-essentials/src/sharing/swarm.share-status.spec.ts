// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.share-status.spec.ts — THE SHARER'S LINE SAYS WHAT HOLDS EACH
// TILE BACK, AND WHETHER THE RELAY TOOK THE PAGE (BCL-2/TS-1, TS-7).
//
// Live, 2026-10-10 04:04-04:43Z: the owner's line read "Sharing 27 · 27
// uploading" in the all-is-well tone for fifty minutes while every tile was a
// name — the page's own host was 'backed-up', and the hosts that held the
// tiles back (a branch's publish domain lower down) were never named. The
// line spoke for the page's host only, and counted every tile not yet served
// as "uploading", whatever the cause.
//
// And "Live · 2 here" was a socket fact: on a congested uplink the tab's own
// page slot and beacon sat unacknowledged for seconds with no sign.
//
// swarm:share-status now carries, for the page this tab stands on:
//   held        — per host holding tiles back: {host, state, reason, why?,
//                 count, names, deep?} (deep: takeable, only the deeper pages
//                 stay on this device);
//   uploading   — only tiles a needed host still owes uploads for;
//   notQueued   — tiles nothing is carrying (a hole, a seal that refuses);
//   deepOnDevice— takeable branches whose deeper pages are still only here;
//   taken       — the relay took the page's current word (its OK);
//   unackedMs   — how long the page's word or the beacon has gone untaken.
//
// The live SwarmDrone runs on fake timers against stubbed IoC peers.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const ROOM = 'downtown'
const SECRET = 'downtown'

const state = vi.hoisted(() => ({
  segments: [] as string[],
  children: new Map<string, string[]>(),
  public: new Set<string>(),
  branch: new Set<string>(),
  // sig → served: its own atoms / its whole closure
  tileServed: new Set<string>(),
  deepServed: new Set<string>(),
  // sig → the hosts its closure is shown on (closureHostsOf)
  closureHosts: new Map<string, string[]>(),
  // sig:deep → closureVerdict answer
  verdicts: new Map<string, Record<string, unknown>>(),
  // ms the relay takes to OK a kind (the mesh's onTaken)
  ackMs: new Map<number, number>(),
  // page → where its tiles go (swarmHostsFor), when not the pool
  pageHosts: new Map<string, { hosts: string[]; source: string; pending: boolean }>(),
}))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: (location: string, name: string) => state.branch.has(`${location}|${name}`),
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

const mesh = {
  publish: vi.fn(async (kind: number, _sig: string, _payload: unknown, _tags?: string[][], onTaken?: () => void) => {
    const ack = state.ackMs.get(kind)
    if (onTaken && ack !== undefined) setTimeout(onTaken, ack)
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

const hostSync: Record<string, unknown> = {
  markPublic: vi.fn(async () => undefined),
  withdrawPublic: vi.fn(),
  isEnabled: () => false,
  isClosureAvailable: vi.fn(async () => false),
  swarmHostsFor: (segments: readonly string[]) => state.pageHosts.get(segments.join('/'))
    ?? { hosts: ['pool-a.example'], source: 'pool', pending: false, passedOver: ['hypercomb.com'] },
  warmSwarmHosts: () => undefined,
  closureHostsOf: (sig: string) => state.closureHosts.get(sig) ?? ['pool-a.example'],
  isClosureAvailableAt: vi.fn(async (sig: string, _kind: string, closure: boolean) =>
    (closure ? state.deepServed : state.tileServed).has(sig)),
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

const statuses: Record<string, unknown>[] = []
EffectBus.on<Record<string, unknown>>('swarm:share-status', (p) => { statuses.push({ ...p, _at: Date.now() }) })
const lastAt = (location: string): Record<string, unknown> | undefined => statuses.filter(s => s['location'] === location).at(-1)

const seedPage = (segments: string[], names: string[], branches: string[] = []): void => {
  const page = segments.join('/')
  state.children.set(page, names)
  for (const n of names) {
    nameByChildSig.set(childSig(page, n), n)
    state.public.add(`/${page}|${n}`)
  }
  for (const n of branches) state.branch.add(`/${page}|${n}`)
}
const hostSays = (host: string, word: string, pending = 0, reason = '', why = ''): void => {
  EffectBus.emit('sync:state', { host, state: word, status: word, pending, reason, ...(why ? { why } : {}), swarm: true })
}
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }
const go = async (segments: string[], ms = 1_000): Promise<void> => {
  state.segments = segments
  lineage.dispatchEvent(new Event('change'))
  await tick(ms)
}

// The relay OKs everything at once unless a case says otherwise.
state.ackMs.set(30200, 5)
state.ackMs.set(30206, 5)

sessionStorage.setItem('hc:mesh-session', 'true')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })
await tick(1_000)

describe('the line names what holds each tile back (BCL-2/TS-1)', () => {
  it('T4: a branch whose deeper pages go to a host that refuses them is named with that host — not "uploading"', async () => {
    // Root's own host is backed up and owes nothing; `br` wears dead-b below.
    seedPage(['t4'], ['br', 'ok-tile'], ['br'])
    state.closureHosts.set(sealOf('t4/br'), ['pool-a.example', 'dead-b.localhost'])
    state.tileServed.add(sealOf('t4/br'))
    state.tileServed.add(sealOf('t4/ok-tile'))
    state.deepServed.add(sealOf('t4/ok-tile'))
    hostSays('pool-a.example', 'backed-up', 0)
    hostSays('dead-b.localhost', 'refused', 10, '403 participants-closed', 'refused')
    await go(['t4'])
    const s = lastAt('/t4')!
    expect(s['held']).toEqual([{
      host: 'dead-b.localhost', state: 'refused', reason: '403 participants-closed', why: 'refused',
      count: 1, names: ['br'], deep: true,
    }])
    expect(s).toMatchObject({ offered: 2, uploading: 0, nameOnly: 0, deepOnDevice: 1, passedOver: ['hypercomb.com'] })
  })

  it('T4 before any re-stage: the branch\'s own page wears a publish domain that refuses — named at once from where that page goes', async () => {
    // host-sync has not re-staged `br2` yet (closureHostsOf knows only the
    // pool), but the page below the tile goes to dead-c, which refuses.
    seedPage(['t4b'], ['br2'], ['br2'])
    state.tileServed.add(sealOf('t4b/br2'))
    state.pageHosts.set('t4b/br2', { hosts: ['dead-c.localhost'], source: 'publish', pending: false })
    hostSays('pool-a.example', 'backed-up', 0)
    hostSays('dead-c.localhost', 'refused', 10, '403 participants-closed', 'refused')
    await go(['t4b'])
    expect(lastAt('/t4b')!['held']).toEqual([{
      host: 'dead-c.localhost', state: 'refused', reason: '403 participants-closed', why: 'refused',
      count: 1, names: ['br2'], deep: true,
    }])
  })

  it('a tile nothing is carrying — every host it needs is backed up and owes nothing — is "not queued", never "uploading" for ever', async () => {
    // `hole` is a name (its closure has an atom no store here holds and no
    // host serves: nothing is queued, so its hosts say backed-up, pending 0).
    // `busy` is a name too, with an upload still owed on the page below it.
    seedPage(['sh1'], ['hole', 'busy'])
    state.closureHosts.set(sealOf('sh1/busy'), ['pool-a.example', 'pool-b.example'])
    hostSays('pool-a.example', 'backed-up', 0)
    hostSays('pool-b.example', 'syncing', 37)
    await go(['sh1'])
    expect(lastAt('/sh1')).toMatchObject({ offered: 2, nameOnly: 2, uploading: 1, notQueued: 1, held: [] })
    // The drain finishes: nothing owed anywhere — and still not served.
    hostSays('pool-b.example', 'backed-up', 0)
    await tick(1_000)
    expect(lastAt('/sh1')).toMatchObject({ uploading: 0, notQueued: 2 })
  })

  it('the gate\'s own word names the atom\'s host: an apex that cannot be reached holds the tiles that need it', async () => {
    seedPage(['apex'], ['fav-1', 'fav-2', 'mine'])
    state.tileServed.add(sealOf('apex/mine'))
    hostSays('pool-a.example', 'backed-up', 0)
    hostSync['closureVerdict'] = vi.fn(async (sig: string) => (sig === sealOf('apex/mine')
      ? { ok: true, ownerHeld: false }
      : { ok: false, ownerHeld: false, blocking: { host: 'hypercomb.com', page: ['apex'], sig, state: 'unreachable', reason: 'timed out', why: 'unreachable' } }))
    try {
      await go(['apex'])
      const s = lastAt('/apex')!
      expect(s['held']).toEqual([{ host: 'hypercomb.com', state: 'unreachable', reason: 'timed out', why: 'unreachable', count: 2, names: ['fav-1', 'fav-2'] }])
      expect(s).toMatchObject({ offered: 3, nameOnly: 2, uploading: 0 })
    } finally { delete hostSync['closureVerdict'] }
  })
})

describe('the line says whether the relay took the page (TS-7)', () => {
  it('taken once the relay OKs the page\'s word; on a congested uplink it says so at 3 s', async () => {
    seedPage(['ack'], ['one'])
    state.tileServed.add(sealOf('ack/one'))
    hostSays('pool-a.example', 'backed-up', 0)
    // The uplink is congested: the relay takes the page's word after 7.3 s
    // (the hunt's T1c D2b: up to 7.3 s unacknowledged, OK p50 14 ms).
    state.ackMs.set(30200, 7_300)
    const from = statuses.length
    state.segments = ['ack']
    lineage.dispatchEvent(new Event('change'))
    await tick(500)
    const first = statuses.slice(from).filter(s => s['location'] === '/ack')
    expect(first.length).toBeGreaterThan(0)
    expect(first.at(-1)).toMatchObject({ taken: false })
    await tick(3_000)
    const late = lastAt('/ack')!
    expect(late['taken']).toBe(false)
    expect(late['unackedMs'] as number).toBeGreaterThanOrEqual(3_000)
    await tick(4_500)
    expect(lastAt('/ack')).toMatchObject({ taken: true, unackedMs: 0 })
    state.ackMs.set(30200, 5)
  })
})
