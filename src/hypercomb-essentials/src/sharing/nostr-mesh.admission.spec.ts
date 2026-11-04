// nostr-mesh.admission.spec.ts — verify at admission, never at runtime (T2).
//
// Before this seam an inbound EVENT was trusted as it came: the relay's copy
// was cached and fanned out on its claimed pubkey, deduped on its claimed id,
// and a lifecycle tombstone with ANY non-empty sig evicted the participant it
// named. Now one check at relay ingress decides, before the cache and before
// the fan-out: the id is the hash, the Schnorr signature verifies for the
// pubkey, created_at is not in the relay's future, the expiration tag is not
// past, a lifecycle event speaks only for its own key, and the relay's
// unsigned will is admitted as exactly that — never as a participant's word.
//
// window.ioc and the WebSocket global are stubbed BEFORE the module import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getEventHash, getPublicKey, type EventTemplate } from 'nostr-tools/pure'

const membership = vi.hoisted(() => ({ joined: true }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined }))

type Frame = unknown[]
type Evt = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: FakeWebSocket[] = []
  readyState = 0
  bufferedAmount = 0
  sent: Frame[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWebSocket.all.push(this) }
  send(data: string): void {
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    if (frame[0] === 'REQ' && frame[1] === 'hc-live') queueMicrotask(() => this.receive(['EOSE', 'hc-live']))
  }
  close(): void { this.readyState = FakeWebSocket.CLOSED }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  receive(msg: Frame): void { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

const ME_SK = new Uint8Array(32).fill(1)
const ME = getPublicKey(ME_SK)
const ALICE_SK = new Uint8Array(32).fill(2)
const ALICE = getPublicKey(ALICE_SK)
const MALLORY_SK = new Uint8Array(32).fill(3)
const MALLORY = getPublicKey(MALLORY_SK)

const services: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrSigner': {
    signEvent: async (e: Record<string, unknown>) =>
      finalizeEvent({ kind: Number(e['kind']), created_at: Number(e['created_at']), tags: e['tags'] as string[][], content: String(e['content']) }, ME_SK),
  },
}
;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
;(window as unknown as { ioc: unknown }).ioc = { register: () => void 0, get: (k: string) => services[k] }

const { NostrMeshDrone } = await import('./nostr-mesh.drone.js')
type Mesh = InstanceType<typeof NostrMeshDrone>
type Heard = { event: Evt; payload: unknown; signed: boolean; relay: string }

const RELAY = 'wss://relay.test'
const T0 = new Date('2026-11-04T18:00:00.000Z').getTime()
const PAGE = 'c'.repeat(64)
const LIFE = 'd'.repeat(64)
const nowSec = (): number => Math.floor(Date.now() / 1000)
const last = (): FakeWebSocket => FakeWebSocket.all[FakeWebSocket.all.length - 1]
const subIdOf = (ws: FakeWebSocket, sig: string): string =>
  String(ws.sent.find(f => f[0] === 'REQ' && ((f[2] as { '#x'?: string[] })['#x'] ?? [])[0] === sig)?.[1] ?? '')
const sentEvents = (ws: FakeWebSocket): Evt[] => ws.sent.filter(f => f[0] === 'EVENT').map(f => f[1] as Evt)

const layer = (sk: Uint8Array, extra: Partial<EventTemplate> = {}, label = 'a'): Evt =>
  finalizeEvent({ created_at: nowSec(), kind: 30200, tags: [['x', PAGE], ['d', 'p'], ['n', label], ['expiration', String(nowSec() + 90)]], content: '{"visuals":[]}', ...extra }, sk) as Evt
const tombstone = (sk: Uint8Array, speaksFor: string, extra: Partial<EventTemplate> = {}): Evt =>
  finalizeEvent({ created_at: nowSec(), kind: 30206, tags: [['x', LIFE], ['d', speaksFor], ['expiration', String(nowSec() + 90)]], content: '{"left":true}', ...extra }, sk) as Evt
/** The relay's last will: id = hash, no signature. */
const will = (pubkey: string, speaksFor = pubkey, content = '{"left":true}'): Evt => {
  const e = { pubkey, created_at: nowSec(), kind: 30206, tags: [['x', LIFE], ['d', speaksFor], ['expiration', String(nowSec() + 60)]], content }
  return { ...e, id: getEventHash(e), sig: '' }
}

let meshes: Mesh[] = []
let heard: Heard[]
let mesh: Mesh
let ws: FakeWebSocket

const admission = (): Record<string, number> => (mesh.getDebug() as { admission: Record<string, number> }).admission
const cachedIds = (sig: string): string[] => mesh.getNonExpired(sig).filter(e => e.relay !== 'local').map(e => String(e.event.id))
const feed = (sig: string, evt: Evt): void => ws.receive(['EVENT', subIdOf(ws, sig), evt])

beforeEach(async () => {
  vi.useFakeTimers({ now: T0 })
  FakeWebSocket.all = []
  localStorage.clear()
  localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([RELAY]))
  mesh = new NostrMeshDrone()
  meshes.push(mesh)
  await Promise.resolve()
  ws = last()
  ws.open()
  heard = []
  mesh.subscribe(PAGE, e => heard.push(e as Heard))
  mesh.subscribe(LIFE, e => heard.push(e as Heard))
})

afterEach(() => {
  for (const m of meshes) m.stop()
  meshes = []
  vi.useRealTimers()
})

describe('a genuine event', () => {
  it('is admitted, cached under its relay and handed to the subscriber as signed', () => {
    const e = layer(ALICE_SK)
    feed(PAGE, e)
    expect(heard.map(h => [h.event.id, h.signed, h.relay])).toEqual([[e.id, true, RELAY]])
    expect(cachedIds(PAGE)).toEqual([e.id])
    expect(admission()).toEqual({})
  })
})

describe('what is refused never reaches a subscriber, and is counted by reason', () => {
  it('a forged signature: the right id, signed by another key', () => {
    const genuine = layer(ALICE_SK)
    const forged = { ...genuine, sig: layer(MALLORY_SK).sig }
    feed(PAGE, forged)
    expect(heard).toEqual([])
    expect(cachedIds(PAGE)).toEqual([])
    expect(admission()).toEqual({ signature: 1 })
  })

  it('a garbage signature on a claimed pubkey', () => {
    const e = { ...layer(ALICE_SK), sig: 'f'.repeat(128) }
    feed(PAGE, e)
    expect(heard).toEqual([])
    expect(admission()).toEqual({ signature: 1 })
  })

  it('tampered content: the id no longer hashes the fields', () => {
    const e = { ...layer(ALICE_SK), content: '{"visuals":[{"name":"planted"}]}' }
    feed(PAGE, e)
    expect(heard).toEqual([])
    expect(admission()).toEqual({ id: 1 })
  })

  it('a replayed id is delivered once; a forged copy sent first cannot poison the genuine one', () => {
    const e = layer(ALICE_SK)
    feed(PAGE, { ...e, sig: 'f'.repeat(128) })   // Mallory, ahead of Alice, with Alice's id
    feed(PAGE, e)
    feed(PAGE, e)
    expect(heard.map(h => h.event.id)).toEqual([e.id])
    expect(admission()).toEqual({ signature: 1, replay: 1 })
  })

  it('a stale created_at: the expiration tag is past, beyond the skew grace', () => {
    const t = nowSec() - 300
    feed(PAGE, layer(ALICE_SK, { created_at: t, tags: [['x', PAGE], ['d', 'p'], ['expiration', String(t + 90)]] }))
    expect(heard).toEqual([])
    expect(admission()).toEqual({ expired: 1 })
  })

  it('an expiration inside the skew grace is still admitted', () => {
    feed(PAGE, layer(ALICE_SK, { tags: [['x', PAGE], ['d', 'p'], ['expiration', String(nowSec() - 10)]] }))
    expect(heard).toHaveLength(1)
  })

  it("a created_at beyond the relay's own future allowance", () => {
    feed(PAGE, layer(ALICE_SK, { created_at: nowSec() + 16 * 60 }))
    expect(heard).toEqual([])
    expect(admission()).toEqual({ future: 1 })
  })

  it('a created_at a few minutes ahead (a fast device) is admitted', () => {
    feed(PAGE, layer(ALICE_SK, { created_at: nowSec() + 5 * 60 }))
    expect(heard).toHaveLength(1)
  })

  it('an unsigned event that is not the relay\'s will', () => {
    feed(PAGE, { ...layer(ALICE_SK), sig: '' })
    expect(heard).toEqual([])
    expect(admission()).toEqual({ unsigned: 1 })
  })

  it('a malformed event: a pubkey that is not a key', () => {
    feed(PAGE, { ...layer(ALICE_SK), pubkey: 'not-a-key' })
    expect(heard).toEqual([])
    expect(admission()).toEqual({ shape: 1 })
  })
})

describe('eviction authority: a lifecycle event speaks only for its own key', () => {
  it("Mallory's signed tombstone naming Alice is refused", () => {
    feed(LIFE, tombstone(MALLORY_SK, ALICE))
    expect(heard).toEqual([])
    expect(admission()).toEqual({ 'speaks-for': 1 })
  })

  it("a tombstone under Alice's key with a forged signature is refused — not read as her leave", () => {
    feed(LIFE, { ...tombstone(ALICE_SK, ALICE), sig: layer(MALLORY_SK).sig })
    expect(heard).toEqual([])
    expect(admission()).toEqual({ signature: 1 })
  })

  it("Alice's own signed tombstone is admitted as her signed word", () => {
    const e = tombstone(ALICE_SK, ALICE)
    feed(LIFE, e)
    expect(heard.map(h => [h.event.id, h.signed])).toEqual([[e.id, true]])
  })

  it("the relay's unsigned will for Alice is admitted, and says so: signed false", () => {
    const e = will(ALICE)
    feed(LIFE, e)
    expect(heard.map(h => [h.event.id, h.signed])).toEqual([[e.id, false]])
    expect(admission()).toEqual({})
  })

  it("an unsigned will whose d names another key, or whose content is not {left}, is refused", () => {
    feed(LIFE, will(MALLORY, ALICE))
    feed(LIFE, will(ALICE, ALICE, '{"alive":true}'))
    expect(heard).toEqual([])
    expect(admission()).toEqual({ 'speaks-for': 1, unsigned: 1 })
  })

  it('a withheld-behaviours broadcast is held to the same rule', () => {
    feed(LIFE, finalizeEvent({ created_at: nowSec(), kind: 30208, tags: [['x', LIFE], ['d', ALICE]], content: '{"withheld":[]}' }, MALLORY_SK) as Evt)
    expect(heard).toEqual([])
    expect(admission()).toEqual({ 'speaks-for': 1 })
  })
})

describe('our own key', () => {
  it("a replay of what this tab sent re-confirms the cache but is not heard a second time", async () => {
    await mesh.publish(30200, PAGE, { visuals: [] }, [['d', 'p']])
    const sent = sentEvents(ws)[0]
    expect(heard.map(h => [h.relay, h.signed])).toEqual([['local', false]])   // the local fanout
    feed(PAGE, sent)
    expect(heard).toHaveLength(1)
    expect(mesh.getNonExpired(PAGE).filter(e => e.relay !== 'local').map(e => [e.event.id, e.relay, e.signed])).toEqual([[sent.id, RELAY, true]])
    expect(admission()).toEqual({ 'self-echo': 1 })
  })

  it("a signed event under our key that this tab did NOT send (another tab, a past session) is heard", () => {
    const e = layer(ME_SK)
    feed(PAGE, e)
    expect(heard.map(h => [h.event.id, h.signed])).toEqual([[e.id, true]])
  })

  it('a forged event under our key cannot move our slot floor into the future', async () => {
    const forged = { ...layer(ME_SK, { created_at: nowSec() + 600 }), sig: 'f'.repeat(128) }
    feed(PAGE, forged)
    await mesh.publish(30200, PAGE, { visuals: [] }, [['d', 'p']])
    expect(sentEvents(ws)[0].created_at).toBe(nowSec())
  })

  it("the relay's will under our key does move the floor (the next beacon must outrank it)", async () => {
    await mesh.publish(30206, LIFE, { alive: true }, [['d', ME]])   // learns our key
    const w = will(ME)
    w.created_at = nowSec() + 40
    w.id = getEventHash(w)
    feed(LIFE, w)
    await mesh.publish(30206, LIFE, { alive: true }, [['d', ME]])
    expect(sentEvents(ws)[1].created_at).toBeGreaterThanOrEqual(nowSec() + 41)
  })
})

describe('the seam is also what the broker asks for a carried event', () => {
  it('admit() answers for an event that arrived inside another (a late-join recovery answer)', () => {
    const e = layer(ALICE_SK)
    expect(mesh.admit(e)).toEqual({ ok: true, signed: true })
    expect(mesh.admit({ ...e, sig: 'f'.repeat(128) })).toEqual({ ok: false, reason: 'signature' })
    expect(mesh.admit({ ...e, created_at: nowSec() - 500 })).toEqual({ ok: false, reason: 'id' })
    expect(mesh.admit(undefined)).toEqual({ ok: false, reason: 'shape' })
  })
})
