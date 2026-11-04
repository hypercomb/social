// content-broker.recovery.spec.ts — late-join recovery carries the original
// signed events, and the asker admits each one as the relay would have.
//
// A responder used to re-pack peers' visuals as bare {pubkey, content,
// created_at, tags} records, and the asker attributed each to its claimed
// pubkey on the responder's say-so: any member could tie any key to any
// tiles. Now the responder carries the ORIGINAL kind-30200 events, id and
// signature included, and the asker hands each to the mesh's admission seam
// (T2). An older responder's bare shape is still read (H3) — but only the
// responder's own entry is taken from it, the one key its signed answer
// vouches for.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, roomPreimage } from '@hypercomb/core'
import { finalizeEvent, getEventHash, getPublicKey, verifyEvent } from 'nostr-tools/pure'

const membership = vi.hoisted(() => ({ joined: true }))
vi.mock('./membership.js', () => ({ isJoinedHere: () => membership.joined }))

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registrations.set(key, value) },
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.boot.drone.js').ContentBrokerDrone

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const HOST = 'hypercomb.com'
const COMPOSED = 'c'.repeat(64)

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}
const channelOf = (room: string, secret: string): Promise<string> => sha256(new TextEncoder().encode(`broker:fetch\0${roomPreimage(room, secret, HOST)}`))

type Evt = { id?: string; kind: number; pubkey: string; created_at?: number; tags: string[][]; content: string; sig?: string }
type Published = { kind: number; sig: string; payload: unknown; tags: string[][] }

const ALICE_SK = new Uint8Array(32).fill(2)
const ALICE = getPublicKey(ALICE_SK)
const MALLORY_SK = new Uint8Array(32).fill(3)
const MALLORY = getPublicKey(MALLORY_SK)
const RESPONDER = 'e'.repeat(64)
const BOB = 'b'.repeat(64)
const nowSec = (): number => Math.floor(Date.now() / 1000)

/** Alice's own layer event at the location, as she signed it. */
const aliceLayer = finalizeEvent({
  kind: 30200, created_at: nowSec(), tags: [['x', COMPOSED], ['d', COMPOSED], ['expiration', String(nowSec() + 90)]],
  content: JSON.stringify({ visuals: [{ name: 'alice-tile' }] }),
}, ALICE_SK)

class FakeMesh {
  swarmHost = (): string => HOST
  published: Published[] = []
  cached: { event: Evt }[] = []
  subs = new Map<string, Set<(e: { event: Evt; payload: unknown }) => void>>()
  publish = async (kind: number, sig: string, payload: unknown, tags: string[][] = []): Promise<boolean> => {
    this.published.push({ kind, sig, payload, tags })
    return true
  }
  subscribe = (sig: string, cb: (e: { event: Evt; payload: unknown }) => void): { close: () => void } => {
    let set = this.subs.get(sig)
    if (!set) { set = new Set(); this.subs.set(sig, set) }
    set.add(cb)
    return { close: () => { set!.delete(cb) } }
  }
  getNonExpired = (sig: string): { event: Evt }[] => (sig === COMPOSED ? this.cached : [])
  /** The seam, as the real mesh judges: id = hash, signature verifies. */
  admit = (evt: unknown): { ok: boolean; signed?: boolean; reason?: string } => {
    const e = evt as Evt
    try {
      const plain = { id: String(e.id), pubkey: e.pubkey, created_at: Number(e.created_at), kind: e.kind, tags: e.tags, content: e.content, sig: String(e.sig) }
      if (getEventHash(plain) !== plain.id) return { ok: false, reason: 'id' }
      return verifyEvent(plain) ? { ok: true, signed: true } : { ok: false, reason: 'signature' }
    } catch { return { ok: false, reason: 'shape' } }
  }
  deliver(sig: string, event: Evt): void { for (const cb of this.subs.get(sig) ?? []) cb({ event, payload: null }) }
}

const b64 = (o: unknown): string => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
const unb64 = (s: string): unknown => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))))

let mesh: FakeMesh
let channel: string

const boot = async (): Promise<InstanceType<typeof ContentBrokerDrone>> => {
  const broker = new ContentBrokerDrone()
  await vi.waitFor(() => expect(mesh.subs.size).toBeGreaterThan(0))
  await new Promise(resolve => setTimeout(resolve, 20))
  return broker
}

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.boot.drone.js'))
})

beforeEach(async () => {
  EffectBus.clear()
  registrations.clear()
  mesh = new FakeMesh()
  registrations.set(MESH_KEY, mesh)
  registrations.set(ROOM_KEY, { value: 'alpha' })
  registrations.set(SECRET_KEY, { value: 'secret' })
  channel = await channelOf('alpha', 'secret')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the asker', () => {
  const answer = (entries: unknown[]): Evt => ({
    kind: 30401, pubkey: RESPONDER, created_at: nowSec(), content: b64(entries),
    tags: [['x', COMPOSED], ['d', COMPOSED], ['t', 'visuals'], ['expiration', String(nowSec() + 90)]], sig: 'a'.repeat(128),
  })

  it("takes a peer's original signed event, and refuses a tampered copy and an unsigned entry naming another key", async () => {
    const broker = await boot()
    const pending = broker.fetchVisualsAt(COMPOSED, 2_000)
    await vi.waitFor(() => expect(mesh.published.some(p => p.kind === 20400 && p.sig === channel)).toBe(true))

    const tampered = { ...aliceLayer, content: JSON.stringify({ visuals: [{ name: 'planted-on-alice' }] }) }
    const forgedSig = { ...aliceLayer, sig: finalizeEvent({ kind: 30200, created_at: nowSec(), tags: [], content: 'x' }, MALLORY_SK).sig }
    const bobBare = { pubkey: BOB, content: JSON.stringify({ visuals: [{ name: 'bob-says-the-responder' }] }), created_at: nowSec(), tags: [] }
    const responderBare = { pubkey: RESPONDER, content: JSON.stringify({ visuals: [{ name: 'responder-own' }] }), created_at: nowSec(), tags: [] }
    mesh.deliver(COMPOSED, answer([tampered, bobBare, { ...aliceLayer }, forgedSig, responderBare]))

    const entries = await pending
    expect(entries?.map(e => [e.pubkey, e.sig ? 'signed' : 'bare', JSON.parse(e.content).visuals[0].name])).toEqual([
      [ALICE, 'signed', 'alice-tile'],
      [RESPONDER, 'bare', 'responder-own'],
    ])
    expect(entries?.[0]).toMatchObject({ id: aliceLayer.id, kind: 30200, sig: aliceLayer.sig })
  })

  it('an answer carrying nothing admissible is no answer — the ask keeps waiting', async () => {
    const broker = await boot()
    const pending = broker.fetchVisualsAt(COMPOSED, 400)
    await vi.waitFor(() => expect(mesh.published.some(p => p.kind === 20400)).toBe(true))
    mesh.deliver(COMPOSED, answer([{ pubkey: MALLORY, content: '{"visuals":[{"name":"x"}]}', created_at: nowSec(), tags: [] }]))
    expect(await pending).toBeNull()
  })
})

describe('the responder', () => {
  it("carries each peer's original event — id, kind and signature — and nothing it cannot vouch for", async () => {
    mesh.cached = [
      { event: aliceLayer as Evt },
      // our own local fanout, before the signer saw it: no pubkey, no sig
      { event: { kind: 30200, pubkey: '', created_at: nowSec(), tags: [], content: '{"visuals":[]}' } },
      // a hide event at the same location is not part of "what is here"
      { event: { ...finalizeEvent({ kind: 30202, created_at: nowSec(), tags: [], content: '{"hidden":[]}' }, MALLORY_SK) } },
    ]
    await boot()
    mesh.deliver(channel, { kind: 20400, pubkey: MALLORY, tags: [['x', channel], ['d', COMPOSED], ['t', 'visuals']], content: '' })
    await vi.waitFor(() => expect(mesh.published.some(p => p.kind === 30401)).toBe(true))

    const sent = mesh.published.find(p => p.kind === 30401)!
    expect(sent.sig).toBe(COMPOSED)
    expect(sent.tags).toEqual(expect.arrayContaining([['d', COMPOSED], ['t', 'visuals']]))
    const carried = unb64(sent.payload as string) as Record<string, unknown>[]
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({ id: aliceLayer.id, pubkey: ALICE, kind: 30200, sig: aliceLayer.sig, content: aliceLayer.content })
    // What was carried is what she signed: the asker's seam admits it.
    expect(mesh.admit(carried[0])).toEqual({ ok: true, signed: true })
  })
})
