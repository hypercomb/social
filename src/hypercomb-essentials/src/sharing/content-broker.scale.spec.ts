// content-broker.scale.spec.ts — the broker at a crowded meeting (SCALE-2,
// SCALE-3, SCALE-4/RM-1, RM-2, BCL-9). Pinned here:
//   1. ONE ANSWER PER SIG: N people asking for one sig at once cost one copy,
//      delivered N times — never N copies each delivered to all N.
//   2. THE AUTHOR ANSWERS FIRST: a sig this tab's own page names is answered
//      at once, whatever its rank in the room.
//   3. A STORED ANSWER IS NOT SENT AGAIN: inside the readers' replay window
//      the holder stands down for the new asker's cancel, and answers only if
//      none comes.
//   4. Answers live as long as anyone reads them (900 s), and are paced.
//   5. THE ASKER: a host that wins ends the mesh leg (closed, cancelled); at
//      most 16 mesh asks are open at once; an atom its page says is hosted is
//      read from the host first.
//   6. deep:'owner': beneath a tile whose deeper pages are only on its
//      sharer's device, the sharer is asked first (no host probe), and the
//      subtree's miss windows re-open when the sharer announces again or the
//      tile flips to hosted.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const membership = vi.hoisted(() => ({ joined: true }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined }))

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registrations.set(key, value) },
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const STORE_KEY = '@hypercomb.social/Store'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'

const MY = '1'.repeat(64)
const PEER = '2'.repeat(64)
const ASKERS = Array.from({ length: 10 }, (_, i) => (i + 3).toString(16).repeat(64))

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const text = (bytes: Uint8Array | null): string | null => (bytes ? new TextDecoder().decode(bytes) : null)
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
// The broker's stand-down ordering key (FNV-1a over sig + pubkey).
const score = (sig: string, pubkey: string): number => {
  let h = 0x811c9dc5
  const s = sig + pubkey
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}
const rankAmong = (sig: string, others: readonly string[]): number => others.filter(p => score(sig, p) < score(sig, MY)).length

type Evt = { kind: number; pubkey: string; tags: string[][]; content: string }
type Published = { kind: number; sig: string; tags: string[][]; content: string; at: number }

class FakeMesh {
  published: Published[] = []
  subs = new Map<string, Set<(e: { event: Evt; payload: unknown }) => void>>()
  items = new Map<string, { event: Partial<Evt> }[]>()
  onPublish: ((p: Published) => void) | null = null
  publish = async (kind: number, sig: string, payload: unknown, tags: string[][] = []): Promise<boolean> => {
    const p = { kind, sig, tags, content: typeof payload === 'string' ? payload : '', at: Date.now() }
    this.published.push(p)
    this.onPublish?.(p)
    return true
  }
  subscribe = (sig: string, cb: (e: { event: Evt; payload: unknown }) => void): { close: () => void } => {
    let set = this.subs.get(sig)
    if (!set) { set = new Set(); this.subs.set(sig, set) }
    set.add(cb)
    return { close: () => { set!.delete(cb) } }
  }
  getNonExpired = (sig: string): { event: Partial<Evt> }[] => this.items.get(sig) ?? []
  deliver(sig: string, event: Evt): void { for (const cb of [...this.subs.get(sig) ?? []]) cb({ event, payload: null }) }
  listening = (): string[] => [...this.subs].filter(([, set]) => set.size > 0).map(([sig]) => sig)
  answers = (sig: string): Published[] => this.published.filter(p => p.kind === 30401 && p.sig === sig)
  asks = (): Published[] => this.published.filter(p => p.kind === 20400)
  cancels = (): Published[] => this.published.filter(p => p.kind === 20402)
}

let ContentBrokerDrone: typeof import('./content-broker.boot.drone.js').ContentBrokerDrone
let mesh: FakeMesh
let channel = ''
const layers = new Map<string, Uint8Array>()

const ask = (pubkey: string, sig: string, type = 'layer'): Evt =>
  ({ kind: 20400, pubkey, tags: [['x', channel], ['d', sig], ['t', type]], content: '' })
const cancel = (pubkey: string, sig: string): Evt =>
  ({ kind: 20402, pubkey, tags: [['x', channel], ['d', sig]], content: '' })
const answer = (pubkey: string, sig: string, bytes: Uint8Array): Evt =>
  ({ kind: 30401, pubkey, tags: [['x', sig], ['d', sig], ['t', 'layer']], content: b64(bytes) })

const boot = async (): Promise<InstanceType<typeof ContentBrokerDrone>> => {
  const broker = new ContentBrokerDrone()
  await vi.waitFor(() => expect(mesh.listening()).toContain(channel))
  await sleep(20)   // the signer's key resolves on a microtask retry
  return broker
}

/** Layer bytes whose sig puts this tab at stand-down rank `want`+ among `others`. */
const layerRanked = async (label: string, others: readonly string[], atLeast: number, atMost = Infinity): Promise<{ sig: string; bytes: Uint8Array }> => {
  for (let i = 0; ; i++) {
    const bytes = enc(`${label} ${i}`)
    const sig = await sha256(bytes)
    const rank = rankAmong(sig, others)
    if (rank >= atLeast && rank <= atMost) return { sig, bytes }
  }
}

beforeAll(async () => {
  // The module registers its own instance at import; give it a mesh it can
  // never ask on, so the only responder in each test is the one booted there.
  registrations.set(MESH_KEY, { subscribe: () => ({ close: () => void 0 }), publish: async () => true })
  ;({ ContentBrokerDrone } = await import('./content-broker.boot.drone.js'))
  await sleep(30)
  channel = await sha256(enc('broker:fetch\0alpha\0secret'))
})

beforeEach(() => {
  EffectBus.clear()
  registrations.clear()
  layers.clear()
  mesh = new FakeMesh()
  membership.joined = true
  registrations.set(MESH_KEY, mesh)
  registrations.set(SIGNER_KEY, { getPublicKeyHex: async () => MY })
  registrations.set(ROOM_KEY, { value: 'alpha' })
  registrations.set(SECRET_KEY, { value: 'secret' })
  registrations.set(STORE_KEY, {
    getLayerLocalBytes: async (sig: string) => layers.get(sig) ?? null,
    writeLayerBytes: async (sig: string, buf: ArrayBuffer) => { layers.set(sig, new Uint8Array(buf)) },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the holder: one copy for a crowd (SCALE-2)', () => {
  it('ten people asking for one sig at once get ONE answer, not ten', async () => {
    const bytes = enc('a layer ten people want')
    const sig = await sha256(bytes)
    layers.set(sig, bytes)
    await boot()
    // The first asker to receive an answer cancels, as the real asker does.
    mesh.onPublish = (p) => { if (p.kind === 30401) setTimeout(() => mesh.deliver(channel, cancel(ASKERS[0]!, sig)), 50) }
    for (const a of ASKERS) mesh.deliver(channel, ask(a, sig))
    await sleep(1200)
    expect(mesh.answers(sig)).toHaveLength(1)
  })

  it("a sig this tab's own page names is answered at once, whatever its rank in the room", async () => {
    // Ranked behind at least two of the ten askers: the room ranking alone
    // would hold this answer back two slots (700 ms).
    const { sig, bytes } = await layerRanked('a fresh tile', ASKERS, 2)
    layers.set(sig, bytes)
    const page = 'e'.repeat(64)
    registrations.set(SWARM_KEY, { composeSigForSegments: async () => page })
    mesh.items.set(page, [{ event: { kind: 30200, pubkey: '', content: JSON.stringify({ visuals: [{ name: 'fresh', layerSig: sig }] }) } }])
    await boot()
    EffectBus.emit('swarm:page-announced', { location: '/', segments: [] })
    await sleep(20)

    const asked = Date.now()
    for (const a of ASKERS) mesh.deliver(channel, ask(a, sig))
    await vi.waitFor(() => expect(mesh.answers(sig).length).toBeGreaterThan(0), { timeout: 1500 })
    expect(mesh.answers(sig)[0]!.at - asked).toBeLessThan(100)
  })

  it('an answer the relay already holds is not sent again: the holder stands down for the new asker\'s cancel', async () => {
    // Ranked first among the two askers: without the replay memo it would
    // answer the second one at once.
    const { sig, bytes } = await layerRanked('a picture asked twice', ASKERS.slice(0, 2), 0, 0)
    layers.set(sig, bytes)
    await boot()
    mesh.deliver(channel, ask(ASKERS[0]!, sig))
    await vi.waitFor(() => expect(mesh.answers(sig)).toHaveLength(1))
    await sleep(50)

    // The second asker subscribed before asking, so the relay replayed the
    // stored answer to it; it verifies and cancels.
    mesh.deliver(channel, ask(ASKERS[1]!, sig))
    setTimeout(() => mesh.deliver(channel, cancel(ASKERS[1]!, sig)), 100)
    await sleep(1100)
    expect(mesh.answers(sig)).toHaveLength(1)
  })

  it('…and answers anyway when no cancel comes (the store dropped it)', async () => {
    const { sig, bytes } = await layerRanked('a picture the store dropped', ASKERS.slice(0, 2), 0, 0)
    layers.set(sig, bytes)
    await boot()
    mesh.deliver(channel, ask(ASKERS[0]!, sig))
    await vi.waitFor(() => expect(mesh.answers(sig)).toHaveLength(1))
    await sleep(50)
    const asked = Date.now()
    mesh.deliver(channel, ask(ASKERS[1]!, sig))
    await vi.waitFor(() => expect(mesh.answers(sig)).toHaveLength(2), { timeout: 2000 })
    expect(mesh.answers(sig)[1]!.at - asked).toBeGreaterThanOrEqual(600)
  })

  it('an answer lives as long as anyone reads it — 900 s, not a day (RM-1 / SCALE-4)', async () => {
    const bytes = enc('a layer kept for the replay window')
    const sig = await sha256(bytes)
    layers.set(sig, bytes)
    await boot()
    mesh.deliver(channel, ask(ASKERS[0]!, sig))
    await vi.waitFor(() => expect(mesh.answers(sig)).toHaveLength(1), { timeout: 1500 })
    const expiration = Number(mesh.answers(sig)[0]!.tags.find(t => t[0] === 'expiration')?.[1])
    expect(expiration - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(900)
    expect(expiration - Math.floor(Date.now() / 1000)).toBeGreaterThan(890)
  })

  it('answers are paced: a burst of 8, then 6 a second (RM-2)', async () => {
    const sigs: string[] = []
    for (let i = 0; i < 20; i++) {
      const bytes = enc(`picture ${i} of a page in demand`)
      const sig = await sha256(bytes)
      layers.set(sig, bytes)
      sigs.push(sig)
    }
    await boot()
    const asked = Date.now()
    for (const sig of sigs) mesh.deliver(channel, ask(ASKERS[0]!, sig))
    await sleep(500)
    const early = mesh.published.filter(p => p.kind === 30401 && p.at - asked < 500).length
    expect(early).toBeLessThanOrEqual(11)
    await vi.waitFor(() => expect(mesh.published.filter(p => p.kind === 30401)).toHaveLength(20), { timeout: 4000 })
  })
})

describe('the asker (SCALE-2 / SCALE-3)', () => {
  it('a host that wins the race closes the mesh leg and cancels it — for this ask only', async () => {
    const bytes = enc('a picture the host already serves')
    const sig = await sha256(bytes)
    localStorage.setItem('hc:nostrmesh:self-domain', 'bytes.example')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!String(url).includes(sig)) return new Response(null, { status: 404 })
      await sleep(30)
      return new Response(bytes as BodyInit, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    }))
    const broker = await boot()
    broker.notePeerLiveness(PEER, [sig])   // a live peer claims it: host and mesh race
    expect(text(await broker.fetchBySig(sig, 'layer'))).toBe(text(bytes))
    await sleep(20)
    expect(mesh.listening()).not.toContain(sig)
    expect(mesh.cancels().map(p => p.tags)).toEqual([[['d', sig], ['expiration', expect.any(String)], ['via', 'host']]])
  })

  it('at most 16 mesh asks are open at once; the rest wait their turn', async () => {
    const broker = await boot()
    const sigs = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32))
    broker.notePeerLiveness(PEER, sigs)
    for (const sig of sigs) void broker.fetchBySig(sig, 'layer')
    await sleep(300)
    expect(mesh.listening().filter(s => sigs.includes(s)).length).toBeLessThanOrEqual(16)
    expect(mesh.asks().length).toBeLessThanOrEqual(16)
    expect(mesh.asks().length).toBeGreaterThan(0)
  })

  it('an atom its page says is hosted is read from the host first — no mesh ask when the host has it', async () => {
    const bytes = enc('a tile whose own atoms are on the host')
    const sig = await sha256(bytes)
    localStorage.setItem('hc:nostrmesh:self-domain', 'bytes.example')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes(sig)
      ? new Response(bytes as BodyInit, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      : new Response(null, { status: 404 })))
    const broker = await boot()
    broker.notePeerLiveness(PEER, [sig], { hosted: [sig] })
    expect(text(await broker.fetchBySig(sig, 'layer'))).toBe(text(bytes))
    expect(mesh.asks()).toEqual([])
  })
})

describe("deep:'owner' — deeper pages on the sharer's device (BCL-9)", () => {
  it('a page beneath the tile is asked of the sharer first, with no host probe', async () => {
    const child = enc('a deeper page still uploading')
    const childSig = await sha256(child)
    const root = enc(JSON.stringify({ name: 'shared', children: [childSig] }))
    const rootSig = await sha256(root)
    layers.set(rootSig, root)   // the tile itself was taken
    localStorage.setItem('hc:nostrmesh:self-domain', 'bytes.example')
    const fetchSpy = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)
    const broker = await boot()
    // The sharer answers asks for the page from its device.
    mesh.onPublish = (p) => {
      if (p.kind === 20400 && p.tags.some(t => t[0] === 'd' && t[1] === childSig)) {
        setTimeout(() => mesh.deliver(childSig, answer(PEER, childSig, child)), 10)
      }
    }
    broker.notePeerLiveness(PEER, [rootSig], { hosted: [rootSig], owner: [rootSig] })
    await sleep(30)

    expect(text(await broker.fetchBySig(childSig, 'layer', 1000))).toBe(text(child))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("its miss windows re-open when the sharer announces again, and when the tile flips to hosted", async () => {
    const away = 'f'.repeat(64)
    const root = enc(JSON.stringify({ name: 'shared', children: [away] }))
    const rootSig = await sha256(root)
    layers.set(rootSig, root)
    const broker = await boot()
    const woken: unknown[] = []
    EffectBus.on('content:arrived', (p) => { woken.push(p) })
    broker.notePeerLiveness(PEER, [rootSig], { owner: [rootSig] })
    await sleep(30)

    // The sharer is away: the deeper page misses and backs off.
    membership.joined = false
    expect(await broker.fetchBySig(away, 'layer', 100)).toBeNull()
    expect(broker.missUntil(away)).toBeGreaterThan(Date.now())

    // Their page event moves (they are back): the window opens — no request made.
    const asksBefore = mesh.published.length
    broker.notePeerLiveness(PEER, [rootSig], { owner: [rootSig] })
    expect(broker.missUntil(away)).toBe(0)
    expect(woken.length).toBeGreaterThan(0)
    expect(mesh.published.length).toBe(asksBefore)

    // A heartbeat inside OWNER_REOPEN_MS opens nothing (no retry storm)…
    expect(await broker.fetchBySig(away, 'layer', 100)).toBeNull()
    broker.notePeerLiveness(PEER, [rootSig], { owner: [rootSig] })
    expect(broker.missUntil(away)).toBeGreaterThan(Date.now())

    // …but the flip to hosted does, at once: the upload finished.
    broker.notePeerLiveness(PEER, [rootSig], { owner: [] })
    expect(broker.missUntil(away)).toBe(0)
  })
})
