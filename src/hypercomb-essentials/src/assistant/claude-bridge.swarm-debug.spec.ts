// @vitest-environment-options {"url": "http://localhost:4298/?claudeBridge=1&claudeBridgePort=2411"}
//
// claude-bridge.swarm-debug.spec.ts — THE SWARM, READ IN ONE CALL.
//
// A live swarm failure on the owner's tab could only be read through
// `effect-last` cells and relay REQs, because opening a second tab on his hive
// is forbidden. `swarm-debug` is the one read (assistant/swarm-debug.ts):
// the swarm drone, the mesh, the share line and the tab's membership. These
// pin that it answers, what it carries, that it carries NO secret and no
// private tile name, that reading it changes nothing, and that it is bounded.
//
// Everything planted here is a fake: the socket, the broker's health answer
// and every service. Nothing dials anywhere.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { MUTATING_OPS } from './bridge-ops.js'
import { publicStorageKey } from '../presentation/tiles/tile-public.js'

class FakeSocket {
  static readonly OPEN = 1
  static made: FakeSocket[] = []
  readyState = 0
  readonly sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) { FakeSocket.made.push(this) }
  send(raw: string): void { this.sent.push(JSON.parse(raw) as Record<string, unknown>) }
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.() }
}
let fetched = 0
vi.stubGlobal('WebSocket', FakeSocket)
vi.stubGlobal('fetch', async () => { fetched++; return { ok: true, json: async () => ({ ok: true }) } })

// ── what must never leave the tab ─────────────────────────────────────
const ROOM_SECRET = 'moonlit-orchard-7741'
const ACCESS_CODE = 'gate-code-9932-xyz'
const NSEC = 'nsec1' + 'q'.repeat(58)
const PRIVATE_KEY_HEX = 'c0ffee'.repeat(10) + 'beef'
const BRIDGE_CODE = 'hcb-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const NIP98 = 'Nostr ' + Buffer.from(JSON.stringify({ kind: 27235, tags: [['u', 'https://host.example/put']], sig: 'ab' })).toString('base64')
const PRIVATE_TILE = 'private-diary'
const PRIVATE_CHILD = 'letters-to-nobody'
const URL_TOKEN = 'Zq9' + 'Xb7Lm2'.repeat(12)
const NEVER = [ROOM_SECRET, ACCESS_CODE, NSEC, PRIVATE_KEY_HEX, BRIDGE_CODE, NIP98.slice(6), PRIVATE_TILE, PRIVATE_CHILD, URL_TOKEN]
// A public page deep enough that its path is longer than any token rule's run.
const LONG_PUBLIC_PAGE = '/orchard/the-long-row-of-apple-trees/by-the-western-fence/near-the-old-stone-well'

// The tab is joined, in its own zone — the stores hold the same pair, so the
// membership resume check keeps it joined.
sessionStorage.setItem('hc:mesh-session', 'true')
sessionStorage.setItem('hc:mesh-zone', JSON.stringify({
  room: 'garden',
  secret: ROOM_SECRET,
  relay: `wss://user:pw@relay.example:7000/meet?code=${ACCESS_CODE}`,
  host: 'host.example',
  code: ACCESS_CODE,
}))
localStorage.setItem('hc:planted:nsec', NSEC)
localStorage.setItem('hc:planted:bridge-code', BRIDGE_CODE)

// The drone keeps its newest walk LAST; this tab walked 100 pages before this
// one — and two pages inside a tile it never made public, whose names (and the
// names under them) must never appear. Every other page is public.
const walks: Record<string, unknown> = {}
for (let i = 0; i < 100; i++) walks[`/page-${i}`] = { ms: i, outcome: 'unchanged', full: 0 }
walks[`/${PRIVATE_TILE}`] = { ms: 1, outcome: 'said', full: 0, private: 2 }
walks[`/garden-page/${PRIVATE_TILE}/${PRIVATE_CHILD}`] = { ms: 2, outcome: 'unchanged', full: 1 }
walks[LONG_PUBLIC_PAGE] = { ms: 3, outcome: 'unchanged', full: 4 }
walks['/garden-page'] = {
  startedAtMs: 1, endedAtMs: 5, ms: 4, outcome: 'said', full: 2, previous: 0, placeholder: 1,
  private: 3, sealsLate: 0, answersLate: 0, privateNames: [PRIVATE_TILE],
}
localStorage.setItem(publicStorageKey('/'), JSON.stringify(['garden-page', ...Array.from({ length: 100 }, (_, i) => `page-${i}`)]))
localStorage.setItem(publicStorageKey('/garden-page'), JSON.stringify(['oak']))
localStorage.setItem('hc:public-branches', JSON.stringify(['/orchard']))

const peerTiles = [
  { name: 'oak', peerPubkey: 'pk1', imageSig: PRIVATE_KEY_HEX },
  { name: 'pine', peerPubkey: 'pk2', note: NSEC },
  ...Array.from({ length: 200 }, (_, i) => ({ name: `tile-${i}`, peerPubkey: 'pk3' })),
]

const swarm = {
  debug: vi.fn(() => ({
    lastSyncInput: { segments: ['garden-page', PRIVATE_TILE, PRIVATE_CHILD], room: 'garden', secretLen: ROOM_SECRET.length, key: `garden-page/${PRIVATE_TILE}`, secret: ROOM_SECRET },
    lastVisitSignal: { name: PRIVATE_TILE, nsec: NSEC },
    visitedPages: [PRIVATE_TILE],
    stickyMode: true,
    currentSig: 'ab12cd34ef56',
    myPubkey: 'f00dbabe',
    room: 'garden',
    secretSet: true,
    subsCount: 3,
    subsBySig: ['ab12cd34ef56'],
    peerLayersCount: 1,
    peerLayersBySig: { ab12cd34ef56: { peerCount: 2, peers: ['11111111', '22222222'] } },
    publishStats: { walkNodeVisits: 10, wireEvents: 4 },
    walks,
    joinedAtMs: 1000,
    firstAnnounce: { page: '/garden-page', atMs: 2000, afterJoinMs: 1000, afterBootMs: 1500, full: 2, previous: 0, placeholder: 1 },
    inFlight: { pages: ['/garden-page', `/garden-page/${PRIVATE_TILE}`], channel: `/${PRIVATE_TILE}/${PRIVATE_CHILD}`, questions: 1, seals: 0, held: [PRIVATE_TILE] },
    ownReplay: { ab12cd34ef56: 4 },
  })),
  participantsAtCurrentSig: () => ['pk1', 'pk2'],
  participantsInZone: () => ['pk1', 'pk2', 'pk3'],
  peerTilesAtCurrentSig: () => peerTiles,
}

const relays = [
  'wss://relay.example:7000/',
  `wss://user:pw@other.example/?code=${ACCESS_CODE}`,
  ...Array.from({ length: 300 }, (_, i) => `wss://r${i}.example/`),
]
const mesh = {
  relays,
  sockets: new Map<string, { readyState: number }>([
    ['wss://relay.example:7000/', { readyState: 1 }],
    [`wss://other.example/?code=${ACCESS_CODE}`, { readyState: 3 }],
  ]),
  stats: { startedAtMs: 1, eventSent: 7, reqSent: 5, rejected: 1, msgIn: 9, lastAuth: NIP98 },
  started: true,
  stopped: false,
  isNetworkEnabled: () => true,
  relaysAddressed: () => true,
  swarmHost: () => 'relay.example:7000',
  // Both start or announce on the way to their answer: a read never calls them.
  getDebug: vi.fn(() => { throw new Error('getDebug starts the mesh') }),
  connectionState: vi.fn(() => { throw new Error('connectionState announces mesh:connection') }),
}

// Two hosts in trouble — one whose NAME holds a secret-sounding word
// ('seed'), which is a host and never a field to drop.
const TROUBLED = new Set(['host.example', 'seedbank.example'])
const hostSync = {
  hostTrouble: vi.fn((host: string) => TROUBLED.has(host)
    ? { host, status: 'refused', why: 'refused', reason: `refused by ${host}: key ${PRIVATE_KEY_HEX} ${BRIDGE_CODE}` }
    : null),
  // A cache miss kicks a local read: never asked by a read.
  swarmHosts: vi.fn(() => { throw new Error('swarmHosts may read') }),
  isGateActive: vi.fn(() => { throw new Error('isGateActive may read') }),
  // The configured targets — pure reads.
  isEnabled: () => true,
  isPublicHostEnabled: () => false,
  publicHostDomain: () => 'pool.example',
  publishNodes: () => ['host.example'],
}

const services = new Map<string, unknown>([
  ['@hypercomb.social/RoomStore', { value: 'garden' }],
  ['@hypercomb.social/SecretStore', { value: ROOM_SECRET }],
  ['@diamondcoreprocessor.com/SwarmDrone', swarm],
  ['@diamondcoreprocessor.com/NostrMeshDrone', mesh],
  ['@diamondcoreprocessor.com/HostSyncService', hostSync],
])
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  get: (key: string) => services.get(key),
  whenReady: () => { /* noop */ },
  onRegister: () => () => { /* noop */ },
  list: () => [...services.keys()],
}

let socket: FakeSocket
let asked = 0

/** Send one op over the renderer's socket and take its answer. */
const ask = async (op: string): Promise<{ id: string; ok: boolean; data?: Record<string, any>; error?: string }> => {
  const id = `swarm-debug-${++asked}`
  socket.onmessage?.({ data: JSON.stringify({ id, op }) })
  await vi.waitFor(() => expect(socket.sent.some(m => m['id'] === id)).toBe(true))
  return socket.sent.find(m => m['id'] === id) as never
}

beforeAll(async () => {
  await import('./claude-bridge.worker.js')
  const worker = services.get('@diamondcoreprocessor.com/ClaudeBridgeWorker') as { pulse(grammar: string): Promise<void> }
  await worker.pulse('')
  await vi.waitFor(() => expect(FakeSocket.made).toHaveLength(1))
  socket = FakeSocket.made[0]!
  socket.open()

  // What the tab's surfaces last heard — said after the worker loaded, so the
  // per-host word is the one each host said last.
  EffectBus.emit('mesh:connection', { state: 'open', reopened: false, since: 1, attempt: 0, clockOffsetMs: 0, refused: `code ${ACCESS_CODE}` })
  EffectBus.emit('swarm:share-status', {
    location: '/garden-page', offered: 4, uploading: 1, nameOnly: 1, private: 3,
    host: 'host.example', hosts: ['host.example'], hostSource: 'publish', hostState: 'refused',
    reason: NIP98, why: 'refused', passedOver: ['pool.example'],
    blocked: [
      { branch: 'oak', host: 'host.example', state: 'refused', why: 'refused', names: [PRIVATE_TILE] },
      { branch: PRIVATE_TILE, host: 'host.example', state: 'full', why: 'full' },
    ],
    privateNames: [PRIVATE_TILE],
  })
  EffectBus.emit('sync:state', {
    host: 'host.example', pending: 2, status: 'refused', state: 'refused',
    reason: `bad token ${BRIDGE_CODE} for ${ACCESS_CODE} by ${NSEC} at /put?t=${URL_TOKEN}`, why: 'refused', swarm: true, missing: 0, source: 'publish',
  })
  EffectBus.emit('sync:state', {
    host: 'seedbank.example', pending: 1, status: 'refused', state: 'refused',
    reason: `bad token ${BRIDGE_CODE} by ${NSEC} at /put?t=${URL_TOKEN}`, why: 'refused', swarm: true, missing: 0, source: 'publish',
  })
  EffectBus.emit('sync:state', { host: 'backup.example', pending: 0, status: 'backed-up', state: 'backed-up', reason: '', swarm: false, missing: 0 })
})

afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the swarm-debug bridge op', () => {
  it('answers — it is a known op', async () => {
    const res = await ask('swarm-debug')
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(typeof res.data?.['at']).toBe('number')
    expect(Object.keys(res.data!).sort()).toEqual(['at', 'membership', 'mesh', 'share', 'swarm'])
  })

  it('is a read — never in the mutating set, so it opens no quiet-landing window', () => {
    expect(MUTATING_OPS.has('swarm-debug')).toBe(false)
  })

  it('reads the swarm drone: walks, first announce, in flight, replay, peers', async () => {
    const swarmPart = (await ask('swarm-debug')).data!['swarm']
    expect(swarmPart.available).toBe(true)
    expect(swarmPart.debugAvailable).toBe(true)
    expect(swarmPart.debugMissing).toEqual([])
    expect(swarmPart.currentSig).toBe('ab12cd34ef56')
    expect(swarmPart.subsCount).toBe(3)
    expect(swarmPart.peerLayersCount).toBe(1)
    expect(swarmPart.peersBySig).toEqual({ ab12cd34ef56: 2 })
    expect(swarmPart.joinedAtMs).toBe(1000)
    expect(swarmPart.firstAnnounce).toEqual({ page: '/garden-page', atMs: 2000, afterJoinMs: 1000, afterBootMs: 1500, full: 2, previous: 0, placeholder: 1 })
    expect(swarmPart.inFlight).toEqual({ pages: ['/garden-page', '/garden-page/[private]'], channel: '/[private]', questions: 1, seals: 0 })
    expect(swarmPart.ownReplay).toEqual({ ab12cd34ef56: 4 })
    expect(swarmPart.publishStats).toEqual({ walkNodeVisits: 10, wireEvents: 4 })
    expect(swarmPart.walks.at(-1)).toEqual({
      page: '/garden-page',
      startedAtMs: 1, endedAtMs: 5, ms: 4, outcome: 'said', full: 2, previous: 0, placeholder: 1,
      private: 3, sealsLate: 0, answersLate: 0,
    })
    // A page inside a tile that is not public keeps its numbers, never its names.
    expect(swarmPart.walks.at(-4)).toEqual({ page: '/[private]', ms: 1, outcome: 'said', full: 0, private: 2 })
    expect(swarmPart.walks.at(-3)).toEqual({ page: '/garden-page/[private]', ms: 2, outcome: 'unchanged', full: 1 })
    // A page under a public branch is public all the way down — and a long
    // path is a path, not a token: it is never redacted.
    expect(swarmPart.walks.at(-2)).toEqual({ page: LONG_PUBLIC_PAGE, ms: 3, outcome: 'unchanged', full: 4 })
    // The page it stands on, up to the first name that is not public.
    expect(swarmPart.lastSyncInput).toEqual({ segments: ['garden-page', '[private]'] })
    expect(swarmPart.participantsAtCurrentSig).toBe(2)
    expect(swarmPart.participantsInZone).toBe(3)
    expect(swarmPart.peerTilesAtCurrentSig.slice(0, 3)).toEqual(['oak', 'pine', 'tile-0'])
    expect(swarmPart.peerTilesAtCurrentSigCount).toBe(202)
  })

  it('reads the mesh without starting it or announcing its connection', async () => {
    const meshPart = (await ask('swarm-debug')).data!['mesh']
    expect(meshPart.available).toBe(true)
    expect(meshPart.started).toBe(true)
    expect(meshPart.networkEnabled).toBe(true)
    expect(meshPart.relaysAddressed).toBe(true)
    expect(meshPart.swarmHost).toBe('relay.example:7000')
    expect(meshPart.connection).toMatchObject({ state: 'open', reopened: false, attempt: 0 })
    // Origins and paths only — never a query, a fragment or a login.
    expect(meshPart.relays.slice(0, 2)).toEqual(['wss://relay.example:7000', 'wss://other.example'])
    expect(meshPart.sockets).toEqual([
      { url: 'wss://relay.example:7000', readyState: 1 },
      { url: 'wss://other.example', readyState: 3 },
    ])
    expect(meshPart.stats).toEqual({ startedAtMs: 1, eventSent: 7, reqSent: 5, rejected: 1, msgIn: 9 })
    expect(mesh.getDebug).not.toHaveBeenCalled()
    expect(mesh.connectionState).not.toHaveBeenCalled()
  })

  it('reads the share line, every host\'s last word and its trouble', async () => {
    const share = (await ask('swarm-debug')).data!['share']
    expect(share.shareStatus).toMatchObject({
      location: '/garden-page', offered: 4, uploading: 1, nameOnly: 1, private: 3,
      host: 'host.example', hosts: ['host.example'], hostSource: 'publish', hostState: 'refused',
      why: 'refused', passedOver: ['pool.example'],
      blocked: [
        { branch: 'oak', host: 'host.example', state: 'refused', why: 'refused' },
        { branch: '[private]', host: 'host.example', state: 'full', why: 'full' },
      ],
    })
    // A host whose name says 'seed' is a host: it is listed, never dropped.
    expect(Object.keys(share.syncByHost).sort()).toEqual(['backup.example', 'host.example', 'seedbank.example'])
    expect(share.syncByHost['host.example']).toMatchObject({ host: 'host.example', pending: 2, status: 'refused', swarm: true, source: 'publish' })
    // A host's words that hold the access code are withheld WHOLE — a
    // cut-out would leave the text around it to give the code back.
    expect(share.syncByHost['host.example'].reason).toBe('[redacted]')
    // Words with no secret in them are kept, with only the token shapes cut.
    expect(share.syncByHost['seedbank.example'].reason).toBe('bad token [redacted] by [redacted] at /put?t=[redacted]')
    expect(share.syncByHost['backup.example']).toMatchObject({ status: 'backed-up', swarm: false })
    expect(share.syncState).toMatchObject({ host: 'backup.example', status: 'backed-up' })
    expect(share.hostTrouble['host.example']).toMatchObject({ host: 'host.example', status: 'refused', why: 'refused' })
    expect(share.hostTrouble['host.example'].reason).toBe('refused by host.example: key c0ffeec0ffee… [redacted]')
    expect(share.hostTrouble['seedbank.example']).toMatchObject({ host: 'seedbank.example', status: 'refused', why: 'refused' })
    expect(share.hostTrouble['backup.example']).toBeNull()
    // Each host's word carries when this tab heard it.
    expect(typeof share.syncByHost['host.example'].heardAtMs).toBe('number')
    // Where the bytes are configured to go, beside where they went.
    expect(share.targets).toEqual({ backupEnabled: true, publicHostEnabled: false, publicHostDomain: 'pool.example', publishNodes: ['host.example'] })
    expect(hostSync.swarmHosts).not.toHaveBeenCalled()
    expect(hostSync.isGateActive).not.toHaveBeenCalled()
  })

  it('says whether the tab is joined, and its zone without the secret or the code', async () => {
    const membership = (await ask('swarm-debug')).data!['membership']
    expect(membership).toEqual({
      joined: true,
      zone: { room: 'garden', relay: 'wss://relay.example:7000/meet', host: 'host.example', hasSecret: true, hasCode: true },
    })
  })

  it('never returns a secret, a code, a key, a token or a private tile name', async () => {
    const res = await ask('swarm-debug')
    expect(res.ok).toBe(true)
    const text = JSON.stringify(res)
    for (const never of NEVER) expect(text, `leaked: ${never.slice(0, 16)}`).not.toContain(never)
    expect(text).not.toMatch(/nsec1[0-9a-z]{20,}/i)
    expect(text).not.toMatch(/[0-9a-f]{64}/i)
    expect(text).not.toMatch(/hcb-[a-z2-7]{16,}/i)
    // No field named for a secret carries a value; storage is never dumped.
    expect(text).not.toMatch(/"(secret|code|nsec|token|privateKey)"\s*:/i)
    expect(text).not.toContain('hc:planted')
    expect(text).not.toContain('hc:mesh-zone')
  })

  it('never defaces a host or a fixed word with a secret it happens to contain', async () => {
    // The secret 'example' sits inside every host here, and the code 'open'
    // IS the connection's state word. Cutting either out of those would hide
    // the host being debugged and hand the secret back by its position.
    const zoneBefore = sessionStorage.getItem('hc:mesh-zone')
    const store = services.get('@hypercomb.social/SecretStore') as { value: string }
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({
      room: 'garden', secret: 'example', relay: 'wss://relay.example:7000/meet', host: 'host.example', code: 'open',
    }))
    store.value = 'example'
    try {
      const res = await ask('swarm-debug')
      const data = res.data!
      expect(data['membership'].zone).toEqual({ room: 'garden', relay: 'wss://relay.example:7000/meet', host: 'host.example', hasSecret: true, hasCode: true })
      expect(data['mesh'].swarmHost).toBe('relay.example:7000')
      expect(data['mesh'].relays.slice(0, 2)).toEqual(['wss://relay.example:7000', 'wss://other.example'])
      expect(data['mesh'].connection.state).toBe('open')
      expect(Object.keys(data['share'].syncByHost).sort()).toEqual(['backup.example', 'host.example', 'seedbank.example'])
      expect(Object.keys(data['share'].hostTrouble)).toContain('host.example')
      expect(data['share'].shareStatus).toMatchObject({ host: 'host.example', hosts: ['host.example'], passedOver: ['pool.example'] })
      expect(data['share'].targets).toMatchObject({ publicHostDomain: 'pool.example', publishNodes: ['host.example'] })
      // Free text that holds the secret goes WHOLE — no fragment, no context.
      expect(data['share'].hostTrouble['host.example'].reason).toBe('[redacted]')
      // Nothing anywhere is a host with a hole cut in it.
      const text = JSON.stringify(res)
      expect(text).not.toMatch(/\[redacted\]\.|\.\[redacted\]|\/\/\[redacted\]/)
    } finally {
      if (zoneBefore === null) sessionStorage.removeItem('hc:mesh-zone')
      else sessionStorage.setItem('hc:mesh-zone', zoneBefore)
      store.value = ROOM_SECRET
    }
  })

  it('withholds the room whole when it IS the secret (both seed from the subdomain)', async () => {
    const zoneBefore = sessionStorage.getItem('hc:mesh-zone')
    sessionStorage.setItem('hc:mesh-zone', JSON.stringify({ room: 'garden', secret: 'Garden', host: 'host.example' }))
    try {
      const res = await ask('swarm-debug')
      expect(res.data!['membership'].zone).toEqual({ room: '[redacted]', relay: null, host: 'host.example', hasSecret: true, hasCode: false })
    } finally {
      if (zoneBefore === null) sessionStorage.removeItem('hc:mesh-zone')
      else sessionStorage.setItem('hc:mesh-zone', zoneBefore)
    }
  })

  it('is read-only — no emit, no storage write, no request, no socket', async () => {
    const emit = vi.spyOn(EffectBus, 'emit')
    const transient = vi.spyOn(EffectBus, 'emitTransient')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const fetchedBefore = fetched
    const socketsBefore = FakeSocket.made.length
    const res = await ask('swarm-debug')
    expect(res.ok).toBe(true)
    expect(emit).not.toHaveBeenCalled()
    expect(transient).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
    expect(fetched).toBe(fetchedBefore)
    expect(FakeSocket.made).toHaveLength(socketsBefore)
    emit.mockRestore(); transient.mockRestore(); setItem.mockRestore(); removeItem.mockRestore()
  })

  it('is bounded — lists and maps stop at 64, strings at 200', async () => {
    const res = await ask('swarm-debug')
    const data = res.data!
    expect(data['swarm'].peerTilesAtCurrentSig.length).toBeLessThanOrEqual(65)
    expect(data['swarm'].peerTilesAtCurrentSig.at(-1)).toMatch(/^… \d+ more$/)
    // Walks keep the NEWEST 64: the page walked last is there, the first is not.
    const pages = (data['swarm'].walks as { page: string }[]).map(w => w.page)
    expect(pages).toHaveLength(64)
    expect(pages.at(-1)).toBe('/garden-page')
    expect(pages).not.toContain('/page-0')
    expect(data['swarm'].walksCount).toBe(104)
    expect(data['mesh'].relays.length).toBeLessThanOrEqual(65)
    const longest = (value: unknown): number => typeof value === 'string' ? value.length
      : Array.isArray(value) ? Math.max(0, ...value.map(longest))
      : value && typeof value === 'object' ? Math.max(0, ...Object.entries(value).map(([k, v]) => Math.max(k.length, longest(v))))
      : 0
    expect(longest(data)).toBeLessThanOrEqual(201)
    expect(JSON.stringify(res).length).toBeLessThan(64_000)
  })

  it('says null, not none, when a mesh field is not there to read', async () => {
    const renamed = { isNetworkEnabled: () => true, relaysAddressed: () => false, swarmHost: () => '' }
    services.set('@diamondcoreprocessor.com/NostrMeshDrone', renamed)
    try {
      const meshPart = (await ask('swarm-debug')).data!['mesh']
      expect(meshPart).toMatchObject({ available: true, relays: null, sockets: null, stats: null, started: null })
    } finally {
      services.set('@diamondcoreprocessor.com/NostrMeshDrone', mesh)
    }
  })

  it('says null, not empty, when the swarm debug() lacks a field — and names what is missing', async () => {
    const key = '@diamondcoreprocessor.com/SwarmDrone'
    try {
      services.set(key, { debug: () => ({}) })
      const bare = (await ask('swarm-debug')).data!['swarm']
      expect(bare).toMatchObject({ available: true, debugAvailable: true, walks: null, walksCount: null, peersBySig: null })
      expect(bare.debugMissing).toContain('walks')
      expect(bare.debugMissing).toContain('peerLayersBySig')

      services.set(key, { participantsInZone: () => ['pk1'] })
      const none = (await ask('swarm-debug')).data!['swarm']
      expect(none).toMatchObject({ available: true, debugAvailable: false, debugMissing: null, walks: null, walksCount: null, peersBySig: null, participantsInZone: 1 })
    } finally {
      services.set(key, swarm)
    }
  })

  it('still answers when nothing is registered — each part says it is unavailable', async () => {
    for (const key of ['@diamondcoreprocessor.com/SwarmDrone', '@diamondcoreprocessor.com/NostrMeshDrone', '@diamondcoreprocessor.com/HostSyncService']) services.delete(key)
    const res = await ask('swarm-debug')
    expect(res.ok).toBe(true)
    expect(res.data!['swarm']).toEqual({ available: false })
    expect(res.data!['mesh']).toMatchObject({ available: false })
    expect(res.data!['share'].hostTrouble).toEqual({})
    expect(res.data!['share'].targets).toBeNull()
    expect(res.data!['membership'].joined).toBe(true)
  })
})
