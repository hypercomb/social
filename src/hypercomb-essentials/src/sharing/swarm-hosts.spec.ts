// swarm-hosts.spec.ts — WHERE A SHARED PAGE'S BYTES GO (jwize 2026-10-07).
//
// Per page, in order: the publish domains of the nearest branch at or above
// it, else the primary of the hosts pool, else — only then, and only when its
// card allows participants — the relay this tab meets at. Synchronous, from
// caches: a miss answers pending and never makes anyone wait.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { SwarmHostResolver, liveSwarmHostDeps, type SwarmHostDeps } from './swarm-hosts.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// Every resolver hears the bus with last-value replay; each test starts on a
// quiet one so an earlier test's pool or card is not replayed into it.
beforeEach(() => { EffectBus.clear() })

/** Let resolved reads and the coalesced 'change' land. */
const settle = async (turns = 10): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setImmediate(resolve))
}

type World = {
  pool: string[] | null
  marks: Map<string, string[]>
  /** Branches whose marks read as unknown (a cold history read). */
  unknownMarks?: Set<string>
  relay: string
  participants: unknown
  loopback: boolean
  /** The meeting host this tab's meeting named ('' = none). */
  meeting?: string
  reads: { pool: number; marks: string[] }
}

const world = (over: Partial<World> = {}): World => ({
  pool: ['hypercomb.com'],
  marks: new Map(),
  relay: 'jwize.com',
  participants: 'all',
  loopback: false,
  reads: { pool: 0, marks: [] },
  ...over,
})

const depsOf = (w: World): SwarmHostDeps => ({
  readPool: async () => { w.reads.pool++; return w.pool },
  readMarks: async (segments) => {
    w.reads.marks.push(segments.join('/'))
    const key = segments.join('/')
    return w.marks.has(key) ? w.marks.get(key)! : (w.unknownMarks?.has(key) ? null : [])
  },
  relay: () => ({ host: w.relay, participants: w.participants }),
  originLoopback: () => w.loopback,
  meetingHost: () => w.meeting ?? '',
})

/** A resolver whose caches are warm for `pages`. */
const warmed = async (w: World, ...pages: string[][]): Promise<SwarmHostResolver> => {
  const r = new SwarmHostResolver(depsOf(w))
  r.warm(null)
  for (const page of pages) r.warm(page)
  await settle()
  return r
}

describe('where a page\'s bytes go', () => {
  it('a fresh install: the pool\'s hypercomb.com — never the relay it meets at', async () => {
    const r = await warmed(world(), ['meetup'])
    expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    expect(r.hostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
  })

  it('a pool host is its write door: the zone root, never a content face', async () => {
    const r = await warmed(world({ pool: ['content.hypercomb.com'] }))
    expect(r.hostsFor(null).hosts).toEqual(['hypercomb.com'])
  })

  it('the pool\'s primary is its first host (the first ADDED — the read\'s order), and only that one', async () => {
    const r = await warmed(world({ pool: ['hypercomb.com', 'alpha.example'] }))
    expect(r.hostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
  })

  it('a pool host that failed this session is passed over: the next one, then the relay — never a strand', async () => {
    const r = await warmed(world({ pool: ['hypercomb.com', 'mine.example'] }))
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    r.markDown('hypercomb.com', 'unreachable')
    await settle()
    expect(changes.length).toBe(1)
    expect(r.hostsFor(null)).toEqual({ hosts: ['mine.example'], source: 'pool', pending: false, passedOver: ['hypercomb.com'] })
    r.markDown('mine.example', 'refused')
    await settle()
    // Sure on your relay: it takes participants.
    expect(r.hostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'relay', pending: false, passedOver: ['hypercomb.com', 'mine.example'] })
    // A relay that takes nobody: the primary keeps the page, so the line can
    // say which host is not taking the bytes and why.
    const closed = await warmed(world({ pool: ['hypercomb.com'], participants: false }))
    closed.markDown('hypercomb.com', 'refused')
    expect(closed.hostsFor(null)).toEqual({ hosts: ['hypercomb.com'], source: 'pool', pending: false })
    // A failure of a publish domain is never passed over: it was chosen.
    const shop = await warmed(world({ marks: new Map([['shop', ['pointblank.example']]]) }), ['shop'])
    shop.markDown('pointblank.example', 'refused')
    expect(shop.hostsFor(['shop']).hosts).toEqual(['pointblank.example'])
    // It answered again, or the participant asked to retry.
    r.markUp('hypercomb.com')
    expect(r.hostsFor(null).hosts).toEqual(['hypercomb.com'])
    r.markDown('hypercomb.com', 'refused')
    r.clearDown()
    expect(r.hostsFor(null).hosts).toEqual(['hypercomb.com'])
  })

  it('publish domains override the pool for a page that wears them — and for the pages below it', async () => {
    const w = world({ marks: new Map([['shop', ['pointblank.example', 'mirror.example']]]) })
    const r = await warmed(w, ['shop'], ['shop', 'shelf', 'jar'], ['elsewhere'])
    expect(r.hostsFor(['shop'])).toEqual({ hosts: ['pointblank.example', 'mirror.example'], source: 'publish', pending: false })
    expect(r.hostsFor(['shop', 'shelf', 'jar'])).toEqual({ hosts: ['pointblank.example', 'mirror.example'], source: 'publish', pending: false })
    expect(r.hostsFor(['elsewhere']).source).toBe('pool')
  })

  it('the NEAREST branch wins', async () => {
    const w = world({ marks: new Map([['shop', ['outer.example']], ['shop/shelf', ['inner.example']]]) })
    const r = await warmed(w, ['shop', 'shelf', 'jar'])
    expect(r.hostsFor(['shop', 'shelf', 'jar']).hosts).toEqual(['inner.example'])
    expect(r.hostsFor(['shop']).hosts).toEqual(['outer.example'])
  })

  it('the relay only when publish domains and the pool are both empty AND its card allows participants', async () => {
    const r = await warmed(world({ pool: [] }), ['meetup'])
    expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['jwize.com'], source: 'relay', pending: false })

    const zones = await warmed(world({ pool: [], participants: 'zones' }))
    expect(zones.hostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'relay', pending: false })

    const closed = await warmed(world({ pool: [], participants: false }))
    expect(closed.hostsFor(null)).toEqual({ hosts: [], source: 'none', pending: false })

    const unheard = await warmed(world({ pool: [], participants: undefined }))
    expect(unheard.hostsFor(null)).toEqual({ hosts: [], source: 'none', pending: true })

    const allowedButPooled = await warmed(world({ pool: ['hypercomb.com'], participants: 'all' }))
    expect(allowedButPooled.hostsFor(null).hosts).toEqual(['hypercomb.com'])
  })

  it('a loopback host is a door only from a loopback page; elsewhere the next source answers', async () => {
    const remote = await warmed(world({ pool: ['localhost:7801', 'hypercomb.com'] }))
    expect(remote.hostsFor(null).hosts).toEqual(['hypercomb.com'])
    const local = await warmed(world({ pool: ['localhost:7801'], loopback: true }))
    expect(local.hostsFor(null)).toEqual({ hosts: ['localhost:7801'], source: 'pool', pending: false })
    const portOnARealHost = await warmed(world({ pool: [], relay: 'evil.example:8443' }))
    expect(portOnARealHost.hostsFor(null)).toEqual({ hosts: [], source: 'none', pending: false })
    // A zone the participant NAMED may carry a port (a self-hosted machine).
    const selfHosted = await warmed(world({ pool: [], marks: new Map([['meetup', ['home.example.net:8443']]]) }), ['meetup'])
    expect(selfHosted.hostsFor(['meetup'])).toEqual({ hosts: ['home.example.net:8443'], source: 'publish', pending: false })
  })
})

describe('the meeting host (jwize 2026-10-09: publish > meeting host > pool > relay)', () => {
  it('a meeting that names its host: before the pool and the relay', async () => {
    const r = await warmed(world({ meeting: 'meet.example' }), ['meetup'])
    expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['meet.example'], source: 'meeting', pending: false })
    expect(r.hostsFor(null)).toEqual({ hosts: ['meet.example'], source: 'meeting', pending: false })
  })

  it('after the page\'s own publish domains', async () => {
    const r = await warmed(world({ meeting: 'meet.example', marks: new Map([['shop', ['pointblank.example']]]) }), ['shop'], ['meetup'])
    expect(r.hostsFor(['shop'])).toEqual({ hosts: ['pointblank.example'], source: 'publish', pending: false })
    expect(r.hostsFor(['meetup']).hosts).toEqual(['meet.example'])
  })

  it('unread marks still make the answer wait — a publish domain could be nearer', async () => {
    const w = world({ meeting: 'meet.example', unknownMarks: new Set(['shop']) })
    const r = new SwarmHostResolver(depsOf(w))
    expect(r.hostsFor(['shop'])).toEqual({ hosts: [], source: 'none', pending: true })
  })

  it('needs no pool read at all', async () => {
    const w = world({ meeting: 'meet.example', pool: null })
    const r = await warmed(w)
    expect(r.hostsFor(null)).toEqual({ hosts: ['meet.example'], source: 'meeting', pending: false })
  })

  it('is the meeting\'s explicit choice: never passed over', async () => {
    const r = await warmed(world({ meeting: 'meet.example' }))
    r.markDown('meet.example', 'refused')
    expect(r.hostsFor(null).hosts).toEqual(['meet.example'])
  })

  it('a loopback meeting host is a door only from a loopback page', async () => {
    const remote = await warmed(world({ meeting: 'localhost:7801' }))
    expect(remote.hostsFor(null).source).toBe('pool')
    const local = await warmed(world({ meeting: 'localhost:7801', loopback: true }))
    expect(local.hostsFor(null)).toEqual({ hosts: ['localhost:7801'], source: 'meeting', pending: false })
  })

  it('a meeting host that changes (a link joined, the selector) is news: the version moves and a change lands', async () => {
    const w = world()
    const r = await warmed(w)
    expect(r.hostsFor(null).source).toBe('pool')
    const before = r.version
    const changed = vi.fn()
    r.addEventListener('change', changed)
    w.meeting = 'meet.example'
    EffectBus.emit('mesh:zone', { relay: 'wss://meet.example' })
    await settle()
    expect(r.version).toBeGreaterThan(before)
    expect(changed).toHaveBeenCalled()
    expect(r.hostsFor(null)).toEqual({ hosts: ['meet.example'], source: 'meeting', pending: false })
  })

  it('the live read is this tab\'s zone (sessionStorage), never another tab\'s', () => {
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', host: 'meet.example' }))
    try {
      expect(liveSwarmHostDeps.meetingHost?.()).toBe('meet.example')
    } finally { sessionStorage.removeItem('hc:mesh-zone') }
    expect(liveSwarmHostDeps.meetingHost?.()).toBe('')
  })
})

describe('never awaited on the connection path', () => {
  it('a cold lookup answers at once — pending, no host — and the reads land later with a change', async () => {
    let releasePool!: (v: string[]) => void
    let releaseMarks!: (v: string[]) => void
    const deps: SwarmHostDeps = {
      readPool: () => new Promise(resolve => { releasePool = resolve }),
      readMarks: () => new Promise(resolve => { releaseMarks = resolve }),
      relay: () => ({ host: 'jwize.com', participants: 'all' }),
      originLoopback: () => false,
    }
    const r = new SwarmHostResolver(deps)
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    const answer = r.hostsFor(['meetup'])
    expect(answer).not.toBeInstanceOf(Promise)
    expect(answer).toEqual({ hosts: [], source: 'none', pending: true })
    // Pending on the marks never falls through to the pool or the relay.
    expect(r.hostsFor(['meetup']).hosts).toEqual([])
    releaseMarks([])
    await settle()
    expect(r.hostsFor(['meetup']).pending).toBe(true) // the pool is still unread
    releasePool(['hypercomb.com'])
    await settle()
    expect(r.hostsFor(['meetup']).hosts).toEqual(['hypercomb.com'])
    expect(changes.length).toBeGreaterThanOrEqual(1)
  })

  it('a warm announces nothing; a lookup that was answered pending is told when the read lands', async () => {
    const quiet = new SwarmHostResolver(depsOf(world()))
    let told = 0
    quiet.addEventListener('change', () => { told++ })
    quiet.warm(['meetup', 'stage'])
    await settle()
    expect(told).toBe(0) // nobody acted on "pending" — no walk again for nothing
    expect(quiet.hostsFor(['meetup', 'stage']).hosts).toEqual(['hypercomb.com'])

    const asked = new SwarmHostResolver(depsOf(world()))
    let heard = 0
    asked.addEventListener('change', () => { heard++ })
    expect(asked.hostsFor(['meetup']).pending).toBe(true)
    await settle()
    expect(heard).toBe(1) // one burst, one change
    expect(asked.hostsFor(['meetup']).hosts).toEqual(['hypercomb.com'])
  })

  it('a read that cannot answer yet (no store) is asked again, not every lookup', async () => {
    const w = world({ pool: null })
    const r = new SwarmHostResolver(depsOf(w))
    for (let i = 0; i < 20; i++) r.hostsFor(null)
    await settle()
    for (let i = 0; i < 20; i++) r.hostsFor(null)
    await settle()
    expect(w.reads.pool).toBe(1)
    expect(r.hostsFor(null).pending).toBe(true)
  })

  it('an unreadable pool is asked again on its own; the answer it then gets is news to whoever waited', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const w = world({ pool: null })
      const r = new SwarmHostResolver(depsOf(w))
      let told = 0
      r.addEventListener('change', () => { told++ })
      expect(r.hostsFor(null).pending).toBe(true)   // asked while the store is closed
      await vi.advanceTimersByTimeAsync(0)
      expect(w.reads.pool).toBe(1)
      w.pool = ['hypercomb.com']                      // the store opens
      await vi.advanceTimersByTimeAsync(1_100)        // no lookup needed
      expect(w.reads.pool).toBe(2)
      expect(told).toBe(1)
      expect(r.hostsFor(null).hosts).toEqual(['hypercomb.com'])
    } finally { vi.useRealTimers() }
  })

  it('the warm path reads each page once; later lookups touch no read at all', async () => {
    const w = world()
    const r = await warmed(w, ['a', 'b'])
    const before = { pool: w.reads.pool, marks: w.reads.marks.length }
    for (let i = 0; i < 100; i++) r.hostsFor(['a', 'b'])
    await settle()
    expect({ pool: w.reads.pool, marks: w.reads.marks.length }).toEqual(before)
    expect(w.reads.marks.sort()).toEqual(['a', 'a/b'])
  })

  it('the swarm, the mesh and host-sync never read the pool or a branch\'s marks themselves', () => {
    for (const file of ['swarm.drone.ts', 'nostr-mesh.drone.ts', 'host-sync.service.ts', 'content-broker.boot.drone.ts', 'meeting-invite.join.ts']) {
      const src = readFileSync(join(HERE, file), 'utf8')
      expect(src, file).not.toMatch(/\blistCommunityHosts\s*\(/)
      expect(src, file).not.toMatch(/\bhostsOfBranch\s*\(/)
    }
    // …and the resolver reads them only inside its refresh paths, never in
    // the synchronous lookup.
    const src = readFileSync(join(HERE, 'swarm-hosts.ts'), 'utf8')
    const lookup = src.slice(src.indexOf('readonly hostsFor = '), src.indexOf('readonly relayHost = '))
    expect(lookup).toContain('#resolve')
    expect(lookup).not.toMatch(/\bawait\b|\.then\(|readPool\(|readMarks\(/)
  })
})

describe('the caches follow their inputs', () => {
  it('a pool change (hosts:render) is a signal to read the pool again — in its own order — with a change', async () => {
    const w = world()
    const r = await warmed(w)
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    // Following a second host never moves the uploads: the first added stays.
    w.pool = ['hypercomb.com', 'alpha.example']
    EffectBus.emit('hosts:render', { open: false, zones: ['alpha.example', 'hypercomb.com'], loaded: true })
    await settle()
    expect(r.hostsFor(null).hosts).toEqual(['hypercomb.com'])
    expect(changes.length).toBe(1)
    // Removing the one ahead of it does.
    w.pool = ['alpha.example']
    EffectBus.emit('hosts:render', { open: false, zones: ['alpha.example'], loaded: true })
    await settle()
    expect(r.hostsFor(null).hosts).toEqual(['alpha.example'])
    expect(changes.length).toBe(2)
    // The panel opening again (the same set) reads nothing.
    const reads = w.reads.pool
    EffectBus.emit('hosts:render', { open: true, zones: ['alpha.example'], loaded: true })
    await settle()
    expect(w.reads.pool).toBe(reads)
  })

  it('an empty hosts:render is believed only from the resolver\'s own read', async () => {
    const w = world()
    const r = await warmed(w)
    w.pool = null // the store is not open: the drone's "none" is not news
    EffectBus.emit('hosts:render', { open: false, zones: [], loaded: true })
    await settle()
    expect(r.hostsFor(null).hosts).toEqual(['hypercomb.com'])
    w.pool = []   // a real read says empty: the relay answers (its card allows)
    EffectBus.emit('hosts:render', { open: false, zones: [], loaded: true })
    await settle()
    expect(r.hostsFor(null)).toEqual({ hosts: ['jwize.com'], source: 'relay', pending: false })
  })

  it('a branch\'s marks changing (hosts:marks-changed) re-reads that branch', async () => {
    const w = world()
    const r = await warmed(w, ['meetup'])
    expect(r.hostsFor(['meetup']).source).toBe('pool')
    w.marks.set('meetup', ['ours.example'])
    EffectBus.emit('hosts:marks-changed', { segments: ['meetup'], zones: ['ours.example'] })
    await settle()
    expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['ours.example'], source: 'publish', pending: false })
  })

  it('a cold history read is unknown, never "no marks": the branch is read again on its own until it answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const w = world({ unknownMarks: new Set(['meetup']) })
      const r = new SwarmHostResolver(depsOf(w))
      let told = 0
      r.addEventListener('change', () => { told++ })
      r.warm(null)
      expect(r.hostsFor(['meetup']).pending).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      // Still cold: pending, and the pool never stands in for the branch.
      expect(r.hostsFor(['meetup'])).toEqual({ hosts: [], source: 'none', pending: true })
      // The store root comes up: the branch's own publish domain answers.
      w.unknownMarks!.clear()
      w.marks.set('meetup', ['pointblank.example'])
      await vi.advanceTimersByTimeAsync(1_100)
      expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['pointblank.example'], source: 'publish', pending: false })
      expect(told).toBeGreaterThanOrEqual(1)
    } finally { vi.useRealTimers() }
  })

  it('the relay\'s card is news only to an answer that reached the relay', async () => {
    const pooled = await warmed(world({ participants: undefined }))
    let told = 0
    pooled.addEventListener('change', () => { told++ })
    EffectBus.emit('mesh:host-card', { relay: 'wss://jwize.com', participants: 'all' })
    await settle()
    expect(told).toBe(0) // a pooled tab's first card walks nothing again
  })

  it('the relay\'s card arriving (mesh:host-card) is news', async () => {
    const w = world({ pool: [], participants: undefined })
    const r = await warmed(w)
    expect(r.hostsFor(null).pending).toBe(true)
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    w.participants = 'all'
    EffectBus.emit('mesh:host-card', { relay: 'wss://jwize.com', participants: 'all' })
    await settle()
    expect(changes.length).toBe(1)
    expect(r.hostsFor(null).hosts).toEqual(['jwize.com'])
  })
})

describe('the live pool read: empty is an answer only when it is one', () => {
  const zoneFile = (zone: string) => ({
    kind: 'file' as const,
    getFile: async () => ({ text: async () => JSON.stringify({ kind: 'visual:host:artifact', meaning: `host:${zone}`, payload: { zone } }) }),
  })
  const dirOf = (zones: string[]) => ({
    async *entries() { for (const z of zones) yield [`sig-${z}`, zoneFile(z)] as const },
  })
  const withStore = async <T>(store: unknown, run: () => Promise<T>): Promise<T> => {
    const g = globalThis as { ioc?: unknown }
    const saved = g.ioc
    g.ioc = { get: (k: string) => (k === '@hypercomb.social/Store' ? store : undefined) }
    try { return await run() } finally { g.ioc = saved }
  }

  it('no store, or a store whose OPFS is not open yet: unknown, not empty', async () => {
    expect(await withStore(undefined, () => liveSwarmHostDeps.readPool())).toBeNull()
    expect(await withStore({ getPool: async () => null }, () => liveSwarmHostDeps.readPool())).toBeNull()
  })

  it('an empty pool the seed has not reached is unknown; once seeded, empty is empty', async () => {
    const store = { getPool: async () => dirOf([]) }
    localStorage.removeItem('hc:hosts:seeded')
    expect(await withStore(store, () => liveSwarmHostDeps.readPool())).toBeNull()
    localStorage.setItem('hc:hosts:seeded', '1')
    expect(await withStore(store, () => liveSwarmHostDeps.readPool())).toEqual([])
    localStorage.removeItem('hc:hosts:seeded')
  })

  it('a pool with hosts is its hosts, seeded or not', async () => {
    const store = { getPool: async () => dirOf(['hypercomb.com']) }
    expect(await withStore(store, () => liveSwarmHostDeps.readPool())).toEqual(['hypercomb.com'])
  })
})

describe('no personal domain is a default', () => {
  const PERSONAL = /jwize\.com|pluginthematrix|realones\.online|pointblanksolutions|revolucionstyle\.com/

  it('the resolver names no domain of its own; the pool seed is hypercomb.com alone', () => {
    const resolver = readFileSync(join(HERE, 'swarm-hosts.ts'), 'utf8')
    const code = resolver.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')
    expect(code).not.toMatch(PERSONAL)
    expect(code).not.toMatch(/['"`][a-z0-9-]+\.(com|io|org|net|ca|online)['"`]/)
    const hostsDrone = readFileSync(join(HERE, 'hosts.drone.ts'), 'utf8')
    expect(hostsDrone).toMatch(/const SEED_HOST = 'hypercomb\.com'/)
  })

  it('host-sync has no swarm host of its own: the relay URL is not read to pick one', () => {
    const src = readFileSync(join(HERE, 'host-sync.service.ts'), 'utf8')
    expect(src).not.toMatch(/swarmHost\?\.\(\)/)
  })
})
