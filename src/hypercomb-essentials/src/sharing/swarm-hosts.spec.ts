// swarm-hosts.spec.ts — WHERE A SHARED PAGE'S BYTES GO (jwize 2026-10-07,
// 2026-10-11: "Let's just make sure that there isn't a default host"; "the
// source of truth is the host field").
//
// Per page, in order: the publish domains of the nearest branch at or above
// it, else the host field (the meeting point the participant entered — the
// mesh's swarmHost), else none. The hosts pool never picks a host, and the
// meeting point's card decides nothing. Synchronous, from caches: a miss
// answers pending and never makes anyone wait.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { SwarmHostResolver, liveSwarmHostDeps, type SwarmHostDeps } from './swarm-hosts.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// Every resolver hears the bus with last-value replay; each test starts on a
// quiet one so an earlier test's signal is not replayed into it.
beforeEach(() => { EffectBus.clear() })

/** Let resolved reads and the coalesced 'change' land. */
const settle = async (turns = 10): Promise<void> => {
  for (let i = 0; i < turns; i++) await new Promise<void>(resolve => setImmediate(resolve))
}

type World = {
  marks: Map<string, string[]>
  /** Branches whose marks read as unknown (a cold history read). */
  unknownMarks?: Set<string>
  /** The host field — the meeting point's host ('' = none). */
  field: string
  /** What the meeting point's card said — read by nothing now. */
  participants: unknown
  loopback: boolean
  reads: { pool: number; marks: string[] }
}

const world = (over: Partial<World> = {}): World => ({
  marks: new Map(),
  field: '',
  participants: 'all',
  loopback: false,
  reads: { pool: 0, marks: [] },
  ...over,
})

const depsOf = (w: World): SwarmHostDeps => {
  const deps = {
    // An older caller's pool read: present, so a test can prove nothing asks it.
    readPool: async () => { w.reads.pool++; return ['hypercomb.com'] },
    readMarks: async (segments: readonly string[]) => {
      w.reads.marks.push(segments.join('/'))
      const key = segments.join('/')
      return w.marks.has(key) ? w.marks.get(key)! : (w.unknownMarks?.has(key) ? null : [])
    },
    relay: () => ({ host: w.field, participants: w.participants }),
    originLoopback: () => w.loopback,
  }
  return deps as SwarmHostDeps
}

/** A resolver whose caches are warm for `pages`. */
const warmed = async (w: World, ...pages: string[][]): Promise<SwarmHostResolver> => {
  const r = new SwarmHostResolver(depsOf(w))
  r.warm(null)
  for (const page of pages) r.warm(page)
  await settle()
  return r
}

const NONE = { hosts: [], source: 'none', pending: false }

describe('where a page\'s bytes go', () => {
  it('a fresh install: no host — NONE, not pending, whatever the pool holds and whatever the card says', async () => {
    for (const participants of ['all', 'zones', false, undefined]) {
      const w = world({ participants })
      const r = await warmed(w, ['meetup'])
      expect(r.hostsFor(['meetup'])).toEqual(NONE)
      expect(r.hostsFor(null)).toEqual(NONE)
      expect(w.reads.pool).toBe(0)
    }
  })

  it('the host field is the upload host — whatever the meeting point\'s card says', async () => {
    for (const participants of ['all', 'zones', false, undefined]) {
      const r = await warmed(world({ field: 'friend.example', participants }), ['meetup'])
      expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
      expect(r.hostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    }
  })

  it('the host field\'s door is the zone root, never a content face', async () => {
    const r = await warmed(world({ field: 'content.friend.example' }))
    expect(r.hostsFor(null).hosts).toEqual(['friend.example'])
    expect(r.relayHost()).toBe('friend.example')
  })

  it('a host field passed over leaves the page on that door, with its why — never a pool host or the relay', async () => {
    const w = world({ field: 'friend.example' })
    const r = await warmed(w)
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    // Silence, or a page at its door, is not enough: its uploads decide.
    r.markDown('friend.example', 'unreachable: timed out')
    r.markDown('friend.example', 'friend.example answers a page — takes no uploads')
    expect(r.hostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    // Its uploads' own standing refusal (AUTO_GRANT off, not a friend): no
    // door below it — the page stays on it, so the line names it and why.
    r.markDown('friend.example', 'refused: 403 no grant')
    await settle()
    expect(changes.length).toBeGreaterThanOrEqual(1)
    expect(r.hostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    expect(r.downReason('friend.example')).toMatch(/^refused:/)
    expect(w.reads.pool).toBe(0)
    // It answered again, or the participant asked to retry.
    r.markUp('friend.example')
    expect(r.downReason('friend.example')).toBe('')
    r.markDown('friend.example', 'full: over quota')
    r.clearDown()
    expect(r.downReason('friend.example')).toBe('')
  })

  it('D2: a publish domain passed over at its HEAD (a page) is still the page\'s; its uploads\' own refusal passes it over, with news', async () => {
    const r = await warmed(world({ field: 'friend.example', marks: new Map([['shop', ['shop.example']]]) }), ['shop'])
    r.markDown('shop.example', 'shop.example answers a page — takes no uploads')
    expect(r.hostsFor(['shop']).hosts).toEqual(['shop.example'])
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    const version = r.version
    r.markDown('shop.example', 'refused: shop.example answers, but lets no upload from this page through', false)
    await settle()
    expect(changes.length).toBe(1)
    expect(r.version).toBeGreaterThan(version)
    expect(r.hostsFor(['shop'])).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false, passedOver: ['shop.example'] })
    // No door below takes bytes: the chosen domain keeps the page, so its
    // status names it — never NONE.
    const alone = await warmed(world({ marks: new Map([['shop', ['shop.example']]]) }), ['shop'])
    alone.markDown('shop.example', 'refused: 405 Method Not Allowed')
    expect(alone.hostsFor(['shop'])).toEqual({ hosts: ['shop.example'], source: 'publish', pending: false })
  })

  it('publish domains override the host field for a page that wears them — and for the pages below it', async () => {
    const w = world({ field: 'friend.example', marks: new Map([['shop', ['pointblank.example', 'mirror.example']]]) })
    const r = await warmed(w, ['shop'], ['shop', 'shelf', 'jar'], ['elsewhere'])
    expect(r.hostsFor(['shop'])).toEqual({ hosts: ['pointblank.example', 'mirror.example'], source: 'publish', pending: false })
    expect(r.hostsFor(['shop', 'shelf', 'jar'])).toEqual({ hosts: ['pointblank.example', 'mirror.example'], source: 'publish', pending: false })
    expect(r.hostsFor(['elsewhere'])).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    // With no host field, an unmarked page has none.
    const bare = await warmed(world({ marks: w.marks }), ['shop'], ['elsewhere'])
    expect(bare.hostsFor(['shop']).source).toBe('publish')
    expect(bare.hostsFor(['elsewhere'])).toEqual(NONE)
  })

  it('the NEAREST branch wins', async () => {
    const w = world({ marks: new Map([['shop', ['outer.example']], ['shop/shelf', ['inner.example']]]) })
    const r = await warmed(w, ['shop', 'shelf', 'jar'])
    expect(r.hostsFor(['shop', 'shelf', 'jar']).hosts).toEqual(['inner.example'])
    expect(r.hostsFor(['shop']).hosts).toEqual(['outer.example'])
  })

  it('a loopback host is a door only from a loopback page; a named port on a real host is kept', async () => {
    const remote = await warmed(world({ field: 'localhost:7801' }))
    expect(remote.hostsFor(null)).toEqual(NONE)
    expect(remote.relayHost()).toBe('')
    const local = await warmed(world({ field: 'localhost:7801', loopback: true }))
    expect(local.hostsFor(null)).toEqual({ hosts: ['localhost:7801'], source: 'meeting', pending: false })
    // The host the participant entered may carry a port (a self-hosted machine).
    const selfHosted = await warmed(world({ field: 'home.example.net:8443' }))
    expect(selfHosted.hostsFor(null)).toEqual({ hosts: ['home.example.net:8443'], source: 'meeting', pending: false })
    expect(selfHosted.relayHost()).toBe('home.example.net:8443')
    const marked = await warmed(world({ marks: new Map([['meetup', ['home.example.net:8443']]]) }), ['meetup'])
    expect(marked.hostsFor(['meetup'])).toEqual({ hosts: ['home.example.net:8443'], source: 'publish', pending: false })
    // Not a host at all.
    const junk = await warmed(world({ field: 'not a host' }))
    expect(junk.hostsFor(null)).toEqual(NONE)
  })
})

describe('the host field (jwize 2026-10-11: publish > host field > none)', () => {
  it('unread marks still make the answer wait — a publish domain could be nearer', async () => {
    const w = world({ field: 'friend.example', unknownMarks: new Set(['shop']) })
    const r = new SwarmHostResolver(depsOf(w))
    expect(r.hostsFor(['shop'])).toEqual({ hosts: [], source: 'none', pending: true })
  })

  it('needs no pool read at all — and the root answers at once, never pending', () => {
    const w = world({ field: 'friend.example' })
    const r = new SwarmHostResolver(depsOf(w))
    expect(r.hostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    const none = new SwarmHostResolver(depsOf(world()))
    expect(none.hostsFor(null)).toEqual(NONE)
    expect(w.reads.pool).toBe(0)
  })

  it('a host field that changes (a link joined, the selector) is news: the version moves and a change lands', async () => {
    for (const signal of ['mesh:zone', 'mesh:connection']) {
      EffectBus.clear()
      const w = world()
      const r = await warmed(w)
      expect(r.hostsFor(null)).toEqual(NONE)
      const before = r.version
      const changed = vi.fn()
      r.addEventListener('change', changed)
      w.field = 'friend.example'
      EffectBus.emit(signal, signal === 'mesh:zone' ? { relay: 'wss://friend.example' } : { state: 'open' })
      await settle()
      expect(r.version, signal).toBeGreaterThan(before)
      expect(changed, signal).toHaveBeenCalled()
      expect(r.hostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
      // Back to no host: news again.
      changed.mockClear()
      w.field = ''
      EffectBus.emit(signal, signal === 'mesh:zone' ? { relay: '' } : { state: 'closed' })
      await settle()
      expect(changed, signal).toHaveBeenCalled()
      expect(r.hostsFor(null)).toEqual(NONE)
    }
  })

  it('the live read is the mesh\'s swarmHost — a link\'s own `host=` decides nothing', () => {
    const g = globalThis as { ioc?: unknown }
    const saved = g.ioc
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'r', secret: 's', host: 'link.example' }))
    try {
      g.ioc = { get: (k: string) => (k === '@diamondcoreprocessor.com/NostrMeshDrone' ? { swarmHost: () => 'point.example' } : undefined) }
      expect(liveSwarmHostDeps.relay().host).toBe('point.example')
      g.ioc = { get: () => undefined }
      expect(liveSwarmHostDeps.relay().host).toBe('')
      g.ioc = { get: () => ({ swarmHost: () => { throw new Error('not yet') } }) }
      expect(liveSwarmHostDeps.relay().host).toBe('')
    } finally {
      g.ioc = saved
      sessionStorage.removeItem('hc:mesh-zone')
    }
  })
})

describe('never awaited on the connection path', () => {
  it('a cold lookup answers at once — pending, no host — and the read lands later with a change', async () => {
    let releaseMarks!: (v: string[]) => void
    const deps: SwarmHostDeps = {
      readMarks: () => new Promise(resolve => { releaseMarks = resolve }),
      relay: () => ({ host: 'friend.example' }),
      originLoopback: () => false,
    }
    const r = new SwarmHostResolver(deps)
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    const answer = r.hostsFor(['meetup'])
    expect(answer).not.toBeInstanceOf(Promise)
    expect(answer).toEqual({ hosts: [], source: 'none', pending: true })
    // Pending on the marks never falls through to the host field.
    expect(r.hostsFor(['meetup']).hosts).toEqual([])
    releaseMarks([])
    await settle()
    expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    expect(changes.length).toBeGreaterThanOrEqual(1)
  })

  it('a warm announces nothing; a lookup that was answered pending is told when the read lands', async () => {
    const quiet = new SwarmHostResolver(depsOf(world({ field: 'friend.example' })))
    let told = 0
    quiet.addEventListener('change', () => { told++ })
    quiet.warm(['meetup', 'stage'])
    await settle()
    expect(told).toBe(0) // nobody acted on "pending" — no walk again for nothing
    expect(quiet.hostsFor(['meetup', 'stage']).hosts).toEqual(['friend.example'])

    const asked = new SwarmHostResolver(depsOf(world({ field: 'friend.example' })))
    let heard = 0
    asked.addEventListener('change', () => { heard++ })
    expect(asked.hostsFor(['meetup']).pending).toBe(true)
    await settle()
    expect(heard).toBe(1) // one burst, one change
    expect(asked.hostsFor(['meetup']).hosts).toEqual(['friend.example'])
  })

  it('the warm path reads each page once; later lookups touch no read at all', async () => {
    const w = world()
    const r = await warmed(w, ['a', 'b'])
    const before = { pool: w.reads.pool, marks: w.reads.marks.length }
    for (let i = 0; i < 100; i++) r.hostsFor(['a', 'b'])
    await settle()
    expect({ pool: w.reads.pool, marks: w.reads.marks.length }).toEqual(before)
    expect(w.reads.pool).toBe(0)
    expect(w.reads.marks.sort()).toEqual(['a', 'a/b'])
  })

  it('the swarm, the mesh and host-sync never read the pool or a branch\'s marks themselves', () => {
    for (const file of ['swarm.drone.ts', 'nostr-mesh.drone.ts', 'host-sync.service.ts', 'content-broker.boot.drone.ts', 'meeting-invite.join.ts']) {
      const src = readFileSync(join(HERE, file), 'utf8')
      expect(src, file).not.toMatch(/\blistCommunityHosts\s*\(/)
      expect(src, file).not.toMatch(/\bhostsOfBranch\s*\(/)
    }
    // …and the resolver reads marks only inside its refresh paths, never in
    // the synchronous lookup.
    const src = readFileSync(join(HERE, 'swarm-hosts.ts'), 'utf8')
    const lookup = src.slice(src.indexOf('readonly hostsFor = '), src.indexOf('readonly relayHost = '))
    expect(lookup).toContain('#resolve')
    expect(lookup).not.toMatch(/\bawait\b|\.then\(|readMarks\(/)
  })

  it('the resolver never reads the hosts pool — no pool tier, no card tier', () => {
    const code = readFileSync(join(HERE, 'swarm-hosts.ts'), 'utf8')
      .split('\n').filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')
    expect(code).not.toMatch(/listCommunityHosts|COMMUNITY_HOSTS_POOL|community:hosts|readPool|HOSTS_SEEDED_KEY|hc:hosts:seeded/)
    expect(code).not.toMatch(/'hosts:render'|'mesh:host-card'|relayParticipants|participants ===/)
    expect(code).not.toMatch(/tabMeetingHost/)
  })
})

describe('the caches follow their inputs', () => {
  it('a hosts pool change (hosts:render) is no news — the pool picks nothing', async () => {
    const w = world({ field: 'friend.example' })
    const r = await warmed(w)
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    const version = r.version
    EffectBus.emit('hosts:render', { open: false, zones: ['alpha.example', 'hypercomb.com'], loaded: true })
    EffectBus.emit('hosts:render', { open: false, zones: [], loaded: true })
    await settle()
    expect(changes.length).toBe(0)
    expect(r.version).toBe(version)
    expect(r.hostsFor(null)).toEqual({ hosts: ['friend.example'], source: 'meeting', pending: false })
    expect(w.reads.pool).toBe(0)
  })

  it('the meeting point\'s card (mesh:host-card) is no news — the host field is the truth', async () => {
    const w = world()
    const r = await warmed(w)
    const changes: number[] = []
    r.addEventListener('change', () => changes.push(1))
    w.participants = 'all'
    EffectBus.emit('mesh:host-card', { relay: 'wss://hypercomb.com', participants: 'all' })
    await settle()
    expect(changes.length).toBe(0)
    expect(r.hostsFor(null)).toEqual(NONE)
  })

  it('a branch\'s marks changing (hosts:marks-changed) re-reads that branch', async () => {
    const w = world({ field: 'friend.example' })
    const r = await warmed(w, ['meetup'])
    expect(r.hostsFor(['meetup']).source).toBe('meeting')
    w.marks.set('meetup', ['ours.example'])
    EffectBus.emit('hosts:marks-changed', { segments: ['meetup'], zones: ['ours.example'] })
    await settle()
    expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['ours.example'], source: 'publish', pending: false })
  })

  it('a cold history read is unknown, never "no marks": the branch is read again on its own until it answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const w = world({ field: 'friend.example', unknownMarks: new Set(['meetup']) })
      const r = new SwarmHostResolver(depsOf(w))
      let told = 0
      r.addEventListener('change', () => { told++ })
      r.warm(null)
      expect(r.hostsFor(['meetup']).pending).toBe(true)
      await vi.advanceTimersByTimeAsync(0)
      // Still cold: pending, and the host field never stands in for the branch.
      expect(r.hostsFor(['meetup'])).toEqual({ hosts: [], source: 'none', pending: true })
      // The store root comes up: the branch's own publish domain answers.
      w.unknownMarks!.clear()
      w.marks.set('meetup', ['pointblank.example'])
      await vi.advanceTimersByTimeAsync(1_100)
      expect(r.hostsFor(['meetup'])).toEqual({ hosts: ['pointblank.example'], source: 'publish', pending: false })
      expect(told).toBeGreaterThanOrEqual(1)
    } finally { vi.useRealTimers() }
  })
})

describe('no personal domain is a default — and no host is', () => {
  const PERSONAL = /jwize\.com|pluginthematrix|realones\.online|pointblanksolutions|revolucionstyle\.com/

  it('the resolver names no domain of its own; the hosts bee seeds none', () => {
    const resolver = readFileSync(join(HERE, 'swarm-hosts.ts'), 'utf8')
    const code = resolver.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n')
    expect(code).not.toMatch(PERSONAL)
    expect(code).not.toMatch(/['"`][a-z0-9-]+\.(com|io|org|net|ca|online)['"`]/)
    const hostsDrone = readFileSync(join(HERE, 'hosts.drone.ts'), 'utf8')
    expect(hostsDrone).not.toMatch(/\bSEED_HOST\b/)
  })

  it('host-sync has no swarm host of its own: the relay URL is not read to pick one', () => {
    const src = readFileSync(join(HERE, 'host-sync.service.ts'), 'utf8')
    expect(src).not.toMatch(/swarmHost\?\.\(\)/)
    expect(src).not.toMatch(/isPoolHost/)
  })
})
