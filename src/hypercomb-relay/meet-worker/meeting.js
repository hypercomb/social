// meeting.js — the meeting point's protocol, with no platform in it.
//
// The always-online meeting point (worker.js) is ONE Durable Object holding
// every socket of every room. This module is everything it says on those
// sockets: the same subset of NIP-01 the swarm speaks to relay.js — EVENT,
// REQ, CLOSE answered with OK, EOSE, CLOSED and NOTICE — and nothing else.
// It owns no socket and no clock: the object hands it a `send`/`close` pair
// per connection and its own timers, so a test drives it with a fake clock
// and the object drives it with the real one.
//
// A MEETING POINT, NOT A STORE (feedback_relay_is_a_meeting_point_not_a_store).
// Memory only: replaceable slots (one per publisher + kind + d, the newest
// wins) and expiring beacons, gone when the object goes. Ephemeral kinds
// (20000–29999) are fanned out and never kept. Bytes never come here; they
// travel by replication to a host (the R2 PUT at pluginthematrix.com).
//
// Ported from relay.js (the home relay), behaviour for behaviour: the hc:host
// first frame, NIP-01/33 slots, NIP-40 expiry, the per-connection token bucket
// under a per-address ceiling, the 200-subscription cap, the room-scoped drain
// word (one room per connection, from its own newest {alive}, with the
// pre-beacon ask hold), the write rule (an `x` is a 64-hex signature), the
// address caps, and soft wills with their 15 s grace, cancel and heir. Two
// things are stricter, because nobody uses what they refuse:
//   • a read names its addresses by `#x` ONLY — an `ids`-only filter is
//     refused like any scan (relay.js also accepts exact ids);
//   • an event that names no `x` at all is acknowledged but never kept: no
//     read could ever reach it.

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

/** sha256 of a UTF-8 string, lowercase hex. Synchronous on purpose: a frame
 *  is handled start to finish with no await, so two frames never interleave. */
export const sha256Hex = (text) => bytesToHex(sha256(utf8ToBytes(String(text))))

// ── limits (relay.js values unless said) ─────────────────────────────────────

export const MAX_MESSAGE_BYTES = 524_288
export const MAX_SUBS_PER_CLIENT = 200
export const MAX_SUBID_LENGTH = 64
export const MAX_FILTERS_PER_REQ = 10
/** relay.js's caps: 16 addresses in one REQ, 256 live on one connection. A
 *  joined tab holds about one address per subscription; the ceiling only
 *  stops one socket parking thousands of guessed room addresses at once —
 *  and every invited guest of every meeting here shares the one access code,
 *  so the code is no barrier to that. */
export const MAX_ADDRESSES_PER_REQ = 16
export const MAX_ADDRESSES_PER_CONNECTION = 256
export const MAX_LIMIT = 5000
/** What the object keeps in memory before it refuses to store more. One
 *  isolate has 128 MB; the rest is sockets, subscriptions and the runtime. */
export const STORE_MAX_BYTES = 64 * 1024 * 1024
/** A Worker cannot send a protocol ping, so a socket whose path died without
 *  a FIN is found by its silence: every live client probes at least every
 *  30 s (hidden) and a throttled hidden tab about once a minute. */
export const REAP_IDLE_MS = 120_000
export const WILL_GRACE_MS = 15_000
export const LIFECYCLE_KIND = 30206
const LIFECYCLE_WILL_TTL = 300   // seconds a synthesized tombstone lingers for late joiners
const FUTURE_SKEW_SECS = 15 * 60

// The per-connection budget and the per-address ceiling (relay.js "AN IP IS
// NOT ONE PARTICIPANT"): EVENT and REQ cost one token; CLOSE never does.
export const BUCKETS = { connBurst: 400, connPerSec: 10, ipBurst: 12_000, ipPerSec: 200 }

// ── the address gate ─────────────────────────────────────────────────────────
//
// THE SIGNATURES ARE THE ONLY THING THAT CAN BE QUERIED. Every filter names
// its `#x` addresses — 64 lowercase hex — and anything else is CLOSED
// `restricted:`: nothing replayed, nothing routed. A read costs the matches at
// its addresses (the x index), never the store. There is no catch-all.
//
//   'hc:live'      the liveness probe: answered EOSE, never kept, never routed.
//   'broker:fetch' the content broker's ask channel on builds before the
//                  room-scoped one. Room-scoped: an event on it reaches a
//                  subscriber only when both connections are in one
//                  lifecycle zone (#zonesOf), only the broker's ask and
//                  cancel may be published there, and nothing on it is ever
//                  replayed.
//
// WRITES NAME A SIGNATURE TOO: an `x` that is not 64-hex (bar the drained
// word's own two kinds) is refused `restricted:`.
export const LIVENESS_WORD = 'hc:live'
const ROOM_SCOPED_WORDS = new Set(['broker:fetch'])
const DRAIN_KINDS = new Set([20400, 20402])  // the broker's ask and its cancel

// ── who is in which room, for the drained word ──────────────────────────────
//
// A connection is in the zone of its own newest {alive} beacon, published ON
// THAT CONNECTION, while that beacon is unexpired — ONE zone, the newest
// replacing the last, so a client that moved rooms and lost its {left} is
// never in both. Nothing else places a connection in a room: not a key that
// spoke on it (any signed event can be replayed by anyone) and never a
// subscription. An ask on the word from a connection in no zone yet — a first
// join, or an older build flushing its queue on a reopen before it beacons —
// is HELD (16 per connection, 3 s) and routed the moment it beacons.
const LIFECYCLE_DEFAULT_TTL = 120  // seconds an {alive} with no expiration counts
export const HELD_ASKS_MAX = 16
export const HELD_ASK_MS = 3_000

/** The OK-false reason for an event filed under an address that is not a
 *  signature, else null (relay.js addressRefusal). */
export function addressRefusal(evt) {
  for (const tag of evt.tags) {
    if (tag[0] !== 'x') continue
    const x = String(tag[1] ?? '')
    if (HEX64.test(x)) continue
    if (ROOM_SCOPED_WORDS.has(x) && DRAIN_KINDS.has(evt.kind)) continue
    return 'restricted: an event is filed under a 64-hex signature (x)'
  }
  return null
}

const isDrainAsk = (evt) => DRAIN_KINDS.has(evt.kind) && evt.tags.some((t) => t[0] === 'x' && ROOM_SCOPED_WORDS.has(t[1]))

const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string')
const isCount = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v))

/** The CLOSED reason for a REQ whose filters are malformed or name no
 *  signature address, else null. Shape first, so nothing below can throw. */
export function filterRefusal(filters) {
  if (filters.length > MAX_FILTERS_PER_REQ) return `invalid: at most ${MAX_FILTERS_PER_REQ} filters in one REQ`
  let named = 0
  for (const f of filters) {
    for (const field of ['ids', 'authors']) if (f[field] !== undefined && !isStringArray(f[field])) return `invalid: ${field} must be an array of strings`
    if (f.kinds !== undefined && !(Array.isArray(f.kinds) && f.kinds.every(Number.isInteger))) return 'invalid: kinds must be an array of integers'
    for (const field of ['since', 'until', 'limit']) if (!isCount(f[field])) return `invalid: ${field} must be a number`
    if (typeof f.limit === 'number' && f.limit < 0) return 'invalid: limit must not be negative'
    for (const key of Object.keys(f)) if (key[0] === '#' && !isStringArray(f[key])) return `invalid: ${key} must be an array of strings`
    const xs = f['#x']
    if (!Array.isArray(xs) || xs.length === 0) return 'restricted: name a signature address (#x) — this meeting point lists nothing'
    if (!xs.every((x) => HEX64.test(x) || ROOM_SCOPED_WORDS.has(x))) return 'restricted: #x must be 64-hex signatures'
    named += xs.length
  }
  return named > MAX_ADDRESSES_PER_REQ ? `invalid: at most ${MAX_ADDRESSES_PER_REQ} addresses in one REQ` : null
}

/** The liveness probe: every filter's `#x` is the probe word and nothing else. */
export const isLivenessProbe = (filters) =>
  filters.every((f) => Array.isArray(f['#x']) && f['#x'].length > 0 && f['#x'].every((x) => x === LIVENESS_WORD))

// ── events ───────────────────────────────────────────────────────────────────

const isEphemeralKind = (kind) => kind >= 20000 && kind < 30000
const isAddressableKind = (kind) => kind >= 30000 && kind < 40000
const isReplaceableKind = (kind) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
const tagValue = (evt, name) => (evt.tags || []).find((t) => Array.isArray(t) && t[0] === name)?.[1]
const dTagOf = (evt) => String(tagValue(evt, 'd') ?? '')
const expirationOf = (evt) => { const n = Number(tagValue(evt, 'expiration')); return Number.isFinite(n) && n > 0 ? n : 0 }
const slotKey = (evt, kind) => `${evt.pubkey}\0${kind}\0${isAddressableKind(kind) ? dTagOf(evt) : ''}`

/** The signature addresses an event names: its 64-hex `x` tag values. */
function addressesOf(evt) {
  const xs = new Set()
  for (const tag of evt.tags || []) if (Array.isArray(tag) && tag[0] === 'x' && HEX64.test(String(tag[1]))) xs.add(String(tag[1]))
  return xs
}

/** NIP-01 id: sha256 of the canonical serialization. */
export const eventId = (evt) => sha256Hex(JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content]))

/** NIP-01: the id is the hash of the event, and the signature is the key's
 *  BIP-340 signature over that id. */
export function verifyEvent(evt) {
  try {
    if (eventId(evt) !== evt.id) return false
    return schnorr.verify(evt.sig, evt.id, evt.pubkey)
  } catch { return false }
}

/** NIP-01 event shape, checked before the (expensive) signature. */
export function eventShapeError(evt, nowSec) {
  if (!evt || typeof evt !== 'object' || Array.isArray(evt)) return 'invalid: event is not an object'
  if (!HEX64.test(String(evt.id))) return 'invalid: id must be 64 lowercase hex'
  if (!HEX64.test(String(evt.pubkey))) return 'invalid: pubkey must be 64 lowercase hex'
  if (!HEX128.test(String(evt.sig))) return 'invalid: sig must be 128 lowercase hex'
  if (!Number.isInteger(evt.kind) || evt.kind < 0 || evt.kind > 65535) return 'invalid: kind must be an integer 0–65535'
  if (!Number.isInteger(evt.created_at)) return 'invalid: created_at must be an integer'
  if (evt.created_at > nowSec + FUTURE_SKEW_SECS) return 'invalid: created_at is too far in the future'
  if (!Array.isArray(evt.tags) || !evt.tags.every((tag) => Array.isArray(tag) && tag.every((v) => typeof v === 'string'))) return 'invalid: tags must be an array of string arrays'
  if (typeof evt.content !== 'string') return 'invalid: content must be a string'
  return null
}

export function matchFilter(filter, evt) {
  if (filter.ids && !filter.ids.includes(evt.id)) return false
  if (filter.authors && !filter.authors.includes(evt.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(evt.kind)) return false
  if (filter.since != null && evt.created_at < filter.since) return false
  if (filter.until != null && evt.created_at > filter.until) return false
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || key.length !== 2 || !Array.isArray(values)) continue
    const name = key[1]
    const held = evt.tags.filter((t) => t[0] === name).map((t) => t[1])
    if (!values.some((v) => held.includes(v))) return false
  }
  return true
}

const matchesAny = (filters, evt) => filters.some((f) => matchFilter(f, evt))

function indexAdd(map, key, value) {
  let set = map.get(key)
  if (!set) { set = new Set(); map.set(key, set) }
  set.add(value)
}

function indexDrop(map, key, value) {
  const set = map.get(key)
  if (!set) return
  set.delete(value)
  if (set.size === 0) map.delete(key)
}

const utf8Length = (text) => text.length * 3 <= MAX_MESSAGE_BYTES ? text.length : utf8ToBytes(text).length

// ── the meeting ──────────────────────────────────────────────────────────────

export class Meeting {
  #now
  #setTimer
  #clearTimer
  #verify
  #log
  #participants
  #maxMessageBytes
  #storeMaxBytes
  #reapIdleMs
  #willGraceMs
  #buckets

  #clients = new Set()
  #events = new Map()      // id → stored event
  #sizes = new Map()       // id → bytes it costs the store
  #storedBytes = 0
  #slots = new Map()       // pubkey\0kind\0d → id of the replaceable event held
  #idsByX = new Map()      // 64-hex x → Set<event id>
  #subsByX = new Map()     // x value → Set<route entry>
  #pendingWills = new Map() // x\0d → { x, d, pubkey, timer }
  #ipBuckets = new Map()   // address → { tokens, at }
  #census = Meeting.#freshCensus()

  /**
   * @param {object} [options]
   * @param {() => number} [options.now] milliseconds
   * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
   * @param {(handle: unknown) => void} [options.clearTimer]
   * @param {(evt: object) => boolean} [options.verify] signature check
   * @param {'all'|'zones'|false} [options.participants] what the hc:host card says the byte host takes
   */
  constructor(options = {}) {
    this.#now = options.now ?? (() => Date.now())
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
    this.#verify = options.verify ?? verifyEvent
    this.#log = options.log ?? ((line) => console.log(line))
    this.#participants = options.participants ?? false
    this.#maxMessageBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES
    this.#storeMaxBytes = options.storeMaxBytes ?? STORE_MAX_BYTES
    this.#reapIdleMs = options.reapIdleMs ?? REAP_IDLE_MS
    this.#willGraceMs = options.willGraceMs ?? WILL_GRACE_MS
    this.#buckets = { ...BUCKETS, ...(options.buckets ?? {}) }
  }

  static #freshCensus() {
    return { refusedEvents: 0, refusedReqs: 0, refusedSubs: 0, unaddressed: 0, refusedFull: 0, handlerErrors: 0, willsFired: 0, willsCancelled: 0, reaped: 0 }
  }

  get size() { return this.#clients.size }
  get pendingWills() { return this.#pendingWills.size }
  get storedEvents() { return this.#events.size }
  get storedBytes() { return this.#storedBytes }

  /** NIP-11 `limitation` — what a pre-meeting curl reads. */
  limitation() {
    return {
      max_message_length: this.#maxMessageBytes,
      max_subscriptions: MAX_SUBS_PER_CLIENT,
      max_subid_length: MAX_SUBID_LENGTH,
      max_limit: MAX_LIMIT,
      max_filters: MAX_FILTERS_PER_REQ,
      max_addresses: MAX_ADDRESSES_PER_REQ,
      max_live_addresses: MAX_ADDRESSES_PER_CONNECTION,
      addressed_reads: true,
      restricted_writes: true,
      auth_required: false,
      access_code: true,
      participant_uploads: this.#participants,
    }
  }

  // ── connections ────────────────────────────────────────────────────────────

  /** A new connection. `socket` is `{ send(text), close(code, reason) }`.
   *  THE HOST CARD is its first frame, before anything is asked: the meeting
   *  point's clock (a client corrects its created_at by it — no round trip)
   *  and whether the byte host takes participants' bytes. */
  connect(socket, { ip = '' } = {}) {
    const now = this.#now()
    const client = {
      socket, ip, closed: false, lastInboundMs: now,
      subs: new Map(), routes: new Map(), lifecycle: new Map(), beaconed: new Set(),
      bucket: { tokens: this.#buckets.connBurst, at: now },
      // the drained word's zone (own newest {alive}) and asks waiting for it
      drainZone: null, heldAsks: [],
    }
    this.#clients.add(client)
    // `addressed`: reads name signatures, writes too, and the drained word is
    // room-scoped by a rule nobody can forge (#zonesOf) — the client's cue to
    // copy its asks onto the word for older builds in the room.
    this.#send(client, ['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: Math.floor(now / 1000), participants: this.#participants, addressed: true })])
    return client
  }

  /** One frame. A throw is this frame's NOTICE and a count, never the meeting. */
  message(client, raw) {
    if (!client || client.closed) return
    client.lastInboundMs = this.#now()
    try { this.#handle(client, typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) }
    catch { this.#census.handlerErrors++; this.#send(client, ['NOTICE', 'error: could not handle that message']) }
  }

  /** The one disconnect path — close, error, reap or recycle. Idempotent, so
   *  a will is armed at most once. */
  disconnect(client) {
    if (!client || client.closed) return
    client.closed = true
    for (const subId of [...client.routes.keys()]) this.#unroute(client, subId)
    try { this.#armWills(client) } catch {}
    this.#clients.delete(client)
  }

  /** Close every connection (the access code was recycled, or the door shut):
   *  each runs the ordinary disconnect, so its wills wait out their grace. */
  closeAll(code, reason) {
    let closed = 0
    for (const client of [...this.#clients]) {
      try { client.socket.close(code, reason) } catch {}
      this.disconnect(client)
      closed++
    }
    return closed
  }

  /** The periodic pass: expired beacons out, idle buckets forgotten, and
   *  sockets that have said nothing for REAP_IDLE_MS closed — a half-open
   *  socket would otherwise hold its subscriptions and its will forever. */
  sweep() {
    const now = this.#now()
    this.#deleteExpired(Math.floor(now / 1000))
    const idle = now - (this.#buckets.ipBurst / this.#buckets.ipPerSec) * 1000
    for (const [ip, bucket] of this.#ipBuckets) if (bucket.at < idle) this.#ipBuckets.delete(ip)
    for (const client of [...this.#clients]) {
      if (now - client.lastInboundMs < this.#reapIdleMs) continue
      try { client.socket.close(1001, 'idle: nothing heard from this socket') } catch {}
      this.disconnect(client)
      this.#census.reaped++
    }
  }

  /** The minute line: counts only — never an address, never a key. A room is
   *  the first 6 hex of its lifecycle sig. Null when there is nothing to say. */
  census() {
    const rooms = new Map()
    for (const c of this.#clients) for (const { x, pubkey } of c.lifecycle.values()) {
      const room = x.slice(0, 6)
      if (!rooms.has(room)) rooms.set(room, new Set())
      rooms.get(room).add(pubkey)
    }
    const c = this.#census
    const said = this.#clients.size + Object.values(c).reduce((a, b) => a + b, 0)
    this.#census = Meeting.#freshCensus()
    if (!said) return null
    const zones = [...rooms].map(([room, keys]) => `${room}:${keys.size}`).join(' ') || 'none'
    return `[minute] open ${this.#clients.size} · refused event ${c.refusedEvents} req ${c.refusedReqs}`
      + `${c.refusedSubs ? ` subs ${c.refusedSubs}` : ''}${c.unaddressed ? ` unaddressed ${c.unaddressed}` : ''}`
      + `${c.refusedFull ? ` full ${c.refusedFull}` : ''}${c.handlerErrors ? ` · handler errors ${c.handlerErrors}` : ''}`
      + ` · wills fired ${c.willsFired} cancelled ${c.willsCancelled}${c.reaped ? ` · reaped ${c.reaped}` : ''}`
      + ` · stored ${this.#events.size} (${this.#storedBytes} bytes) · zones ${zones}`
  }

  logCensus() {
    const line = this.census()
    if (line) this.#log(line)
  }

  // ── frames ─────────────────────────────────────────────────────────────────

  #send(client, msg) {
    if (client.closed) return
    try { client.socket.send(JSON.stringify(msg)) } catch {}
  }

  #handle(client, raw) {
    if (utf8Length(raw) > this.#maxMessageBytes) {
      const id = raw.startsWith('["EVENT"') ? raw.match(/"id"\s*:\s*"([0-9a-f]{64})"/)?.[1] : undefined
      if (id) this.#send(client, ['OK', id, false, `invalid: message exceeds ${this.#maxMessageBytes} bytes`])
      else this.#send(client, ['NOTICE', `error: message exceeds ${this.#maxMessageBytes} bytes`])
      return
    }
    let msg
    try { msg = JSON.parse(raw) } catch { this.#send(client, ['NOTICE', 'error: invalid JSON']); return }
    if (!Array.isArray(msg) || msg.length < 1) { this.#send(client, ['NOTICE', 'error: invalid message']); return }
    const type = msg[0]

    // Never charged, never refused: a CLOSE dropped is a subscription the
    // client has already forgotten, still costing the fan-out.
    if (type === 'CLOSE') {
      client.subs.delete(msg[1])
      this.#unroute(client, String(msg[1] ?? ''))
      return
    }
    if (type !== 'EVENT' && type !== 'REQ') return  // AUTH, COUNT, … — not spoken here
    if (!this.#takeToken(client)) {
      if (type === 'EVENT') { this.#census.refusedEvents++; this.#send(client, ['OK', msg[1]?.id ?? '', false, 'rate-limited: slow down']) }
      else { this.#census.refusedReqs++; this.#send(client, ['CLOSED', String(msg[1] ?? ''), 'rate-limited: slow down']) }
      return
    }
    if (type === 'EVENT') this.#onEvent(client, msg[1])
    else this.#onReq(client, msg[1], msg.slice(2))
  }

  #onEvent(client, evt) {
    const nowSec = Math.floor(this.#now() / 1000)
    const shape = eventShapeError(evt, nowSec)
    if (shape) { this.#send(client, ['OK', HEX64.test(String(evt?.id)) ? evt.id : '', false, shape]); return }
    const unaddressed = addressRefusal(evt)
    if (unaddressed) { this.#census.unaddressed++; this.#send(client, ['OK', evt.id, false, unaddressed]); return }
    if (!this.#verify(evt)) { this.#send(client, ['OK', evt.id, false, 'invalid: bad signature']); return }

    // A verified EVENT speaks for a slot's pending will only on a connection
    // that beaconed that slot — the participant, still here.
    if (this.#pendingWills.size) for (const key of client.beaconed) this.#cancelWill(key)

    const verdict = this.#insert(evt)
    if (verdict === 'full') {
      this.#census.refusedFull++
      this.#send(client, ['OK', evt.id, false, 'error: the meeting point is full — try again shortly'])
      return
    }
    // A duplicate beacon from a NEW connection (a refresh inside the same
    // second) still says the participant lives here now.
    if (evt.kind === LIFECYCLE_KIND) this.#trackLifecycle(client, evt)
    if (verdict === 'duplicate') { this.#send(client, ['OK', evt.id, true, 'duplicate: already have this event']); return }
    this.#send(client, ['OK', evt.id, true, ''])
    // A stale replaceable is accepted but not fanned out: subscribers hold the
    // newer slot. An ask on the drained word from a connection in no room yet
    // waits for its beacon.
    if (verdict === 'stale') return
    if (isDrainAsk(evt) && this.#zonesOf(client).length === 0) this.#holdAsk(client, evt)
    else this.#broadcast(evt, client)
  }

  #onReq(client, subId, filters) {
    if (typeof subId !== 'string' || !subId || subId.length > MAX_SUBID_LENGTH) {
      this.#send(client, ['CLOSED', String(subId ?? ''), `invalid: subscription id must be 1–${MAX_SUBID_LENGTH} characters`])
      return
    }
    if (filters.length === 0 || !filters.every((f) => f && typeof f === 'object' && !Array.isArray(f))) {
      this.#send(client, ['CLOSED', subId, 'invalid: a REQ needs at least one filter object'])
      return
    }
    // A REQ replaces any subscription of the same id (NIP-01), so a refused
    // or probing REQ also ends whatever that id was listening to.
    const probe = isLivenessProbe(filters)
    const refusal = probe ? null : filterRefusal(filters)
    if (probe || refusal) {
      client.subs.delete(subId)
      this.#unroute(client, subId)
      if (probe) { this.#send(client, ['EOSE', subId]); return }
      this.#census.unaddressed++
      this.#send(client, ['CLOSED', subId, refusal])
      return
    }
    if (client.subs.size >= MAX_SUBS_PER_CLIENT && !client.subs.has(subId)) {
      this.#census.refusedSubs++
      this.#send(client, ['CLOSED', subId, `error: too many subscriptions (max ${MAX_SUBS_PER_CLIENT})`])
      return
    }
    let asked = 0
    for (const f of filters) asked += f['#x'].length
    if (this.#liveAddressCount(client, subId) + asked > MAX_ADDRESSES_PER_CONNECTION) {
      client.subs.delete(subId)
      this.#unroute(client, subId)
      this.#census.refusedSubs++
      this.#send(client, ['CLOSED', subId, `error: too many live addresses (max ${MAX_ADDRESSES_PER_CONNECTION} per connection)`])
      return
    }
    client.subs.set(subId, filters)
    this.#route(client, subId, filters)
    // limit:0 asks for nothing stored — a live-only listen.
    if (!filters.every((f) => f.limit === 0)) for (const evt of this.#query(filters)) this.#send(client, ['EVENT', subId, evt])
    this.#send(client, ['EOSE', subId])
  }

  // ── store ──────────────────────────────────────────────────────────────────

  /** 'stored' | 'duplicate' | 'stale' | 'ephemeral' | 'unaddressed' | 'full' */
  #insert(evt) {
    const kind = evt.kind
    if (isEphemeralKind(kind)) return 'ephemeral'
    if (this.#events.has(evt.id)) return 'duplicate'
    // No read can reach an event that names no signature: keep nothing.
    if (addressesOf(evt).size === 0) return 'unaddressed'
    const slotted = isAddressableKind(kind) || isReplaceableKind(kind)
    const key = slotted ? slotKey(evt, kind) : null
    const heldId = key ? this.#slots.get(key) : undefined
    const held = heldId ? this.#events.get(heldId) : undefined
    // NIP-01: one event per slot — the newest; on equal created_at the lowest id.
    if (held && (held.created_at > evt.created_at || (held.created_at === evt.created_at && held.id < evt.id))) return 'stale'
    const rec = { id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, kind, tags: evt.tags, content: evt.content, sig: evt.sig }
    const size = JSON.stringify(rec).length
    if (this.#storedBytes - (heldId ? this.#sizes.get(heldId) ?? 0 : 0) + size > this.#storeMaxBytes) return 'full'
    if (heldId) this.#drop(heldId)
    if (key) this.#slots.set(key, evt.id)
    this.#events.set(rec.id, rec)
    this.#sizes.set(rec.id, size)
    this.#storedBytes += size
    for (const x of addressesOf(rec)) indexAdd(this.#idsByX, x, rec.id)
    return 'stored'
  }

  #drop(id) {
    const rec = this.#events.get(id)
    if (!rec) return
    this.#events.delete(id)
    this.#storedBytes -= this.#sizes.get(id) ?? 0
    this.#sizes.delete(id)
    for (const x of addressesOf(rec)) indexDrop(this.#idsByX, x, id)
    if (isAddressableKind(rec.kind) || isReplaceableKind(rec.kind)) {
      const key = slotKey(rec, rec.kind)
      if (this.#slots.get(key) === id) this.#slots.delete(key)
    }
  }

  /** Read by address only: the ids held at each filter's `#x`, never the store. */
  #query(filters) {
    const nowSec = Math.floor(this.#now() / 1000)
    const results = []
    const seen = new Set()
    for (const f of filters) {
      const hits = []
      for (const x of f['#x']) for (const id of this.#idsByX.get(x) ?? []) {
        if (seen.has(id)) continue
        const evt = this.#events.get(id)
        if (!evt) continue
        const exp = expirationOf(evt)
        if (exp && exp < nowSec) continue  // NIP-40: never replay an expired beacon, even before the sweep
        if (matchFilter(f, evt)) { hits.push(evt); seen.add(id) }
      }
      hits.sort((a, b) => b.created_at - a.created_at)
      results.push(...hits.slice(0, Math.min(f.limit ?? 500, MAX_LIMIT)))
    }
    return results.slice(0, MAX_LIMIT)
  }

  #deleteExpired(nowSec) {
    for (const [id, evt] of this.#events) {
      const exp = expirationOf(evt)
      if (exp && exp < nowSec) this.#drop(id)
    }
  }

  // ── budgets ────────────────────────────────────────────────────────────────

  #takeToken(client) {
    const now = this.#now()
    const b = this.#buckets
    let venue = this.#ipBuckets.get(client.ip)
    if (!venue) { venue = { tokens: b.ipBurst, at: now }; this.#ipBuckets.set(client.ip, venue) }
    const refill = (bucket, burst, perSec) => {
      bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * perSec / 1000)
      bucket.at = now
    }
    refill(client.bucket, b.connBurst, b.connPerSec)
    refill(venue, b.ipBurst, b.ipPerSec)
    if (client.bucket.tokens < 1 || venue.tokens < 1) return false
    client.bucket.tokens--
    venue.tokens--
    return true
  }

  // ── routing ────────────────────────────────────────────────────────────────
  //
  // An event is offered only to the subscriptions that named one of its `x`
  // values — cost per event is the listeners at its address, never the
  // listeners on the meeting point.

  #route(client, subId, filters) {
    this.#unroute(client, subId)
    const entry = { client, subId }
    const xs = new Set()
    for (const f of filters) for (const x of f['#x']) xs.add(x)
    for (const x of xs) indexAdd(this.#subsByX, x, entry)
    client.routes.set(subId, { entry, xs })
  }

  #unroute(client, subId) {
    const route = client.routes.get(subId)
    if (!route) return
    client.routes.delete(subId)
    for (const x of route.xs) indexDrop(this.#subsByX, x, route.entry)
  }

  /** How many addresses a connection's live subscriptions name, but `subId`'s. */
  #liveAddressCount(client, subId) {
    let n = 0
    for (const [id, route] of client.routes) if (id !== subId) n += route.xs.size
    return n
  }

  /** The lifecycle zone a connection is in (see above): its own beacon's, or none. */
  #zonesOf(client) {
    const own = client.drainZone
    return own && own.exp > Math.floor(this.#now() / 1000) ? [own.x] : []
  }

  /** Hold an ask until its connection beacons (oldest dropped past the cap). */
  #holdAsk(client, evt) {
    client.heldAsks.push({ evt, at: this.#now() })
    if (client.heldAsks.length > HELD_ASKS_MAX) client.heldAsks.shift()
  }

  /** The connection is in a zone now: route what it asked meanwhile. */
  #releaseHeldAsks(client) {
    if (client.heldAsks.length === 0) return
    const held = client.heldAsks
    client.heldAsks = []
    const cutoff = this.#now() - HELD_ASK_MS
    for (const { evt, at } of held) if (at >= cutoff) this.#broadcast(evt, client)
  }

  /** `source` is the connection it came from (never echoed), or null for one
   *  the meeting point made. A room-scoped word reaches only subscribers in a
   *  zone `source` is in. */
  #broadcast(evt, source) {
    const candidates = new Set()
    let sourceZones = null
    for (const tag of evt.tags || []) {
      if (!Array.isArray(tag) || tag[0] !== 'x') continue
      const value = String(tag[1])
      const set = this.#subsByX.get(value)
      if (!set) continue
      if (!ROOM_SCOPED_WORDS.has(value)) { for (const entry of set) candidates.add(entry); continue }
      sourceZones ??= source ? this.#zonesOf(source) : []
      if (sourceZones.length === 0) continue
      for (const entry of set) if (this.#zonesOf(entry.client).some((x) => sourceZones.includes(x))) candidates.add(entry)
    }
    const frame = (subId) => JSON.stringify(['EVENT', subId, evt])
    for (const { client: c, subId } of candidates) {
      if (c === source || c.closed) continue
      const filters = c.subs.get(subId)
      if (filters && matchesAny(filters, evt)) try { c.socket.send(frame(subId)) } catch {}
    }
  }

  // ── soft wills ─────────────────────────────────────────────────────────────
  //
  // A tab that dies cannot send its own {left}. The meeting point remembers
  // the last {alive} beacon each connection published in a slot (x = zone, d
  // = pubkey) and, when the socket dies, tombstones it — but only after a
  // GRACE: a reload, a network hop or a NAT rebind kills a socket while the
  // person is still there. Any {alive}/{left} on the slot, or any verified
  // EVENT on a connection that beaconed it, cancels the will; another open
  // connection that beaconed the slot inherits it instead. The tombstone is
  // unsigned (the meeting point cannot sign as the participant) and can only
  // remove a peer's tiles, never add content.

  #lifecycleInfo(evt) {
    const x = tagValue(evt, 'x')
    const d = tagValue(evt, 'd')
    if (!x || !d) return null
    let left = false
    try { const c = JSON.parse(evt.content || '{}'); left = !!(c && c.left === true) } catch {}
    return { x: String(x), d: String(d), pubkey: String(evt.pubkey || ''), left }
  }

  #trackLifecycle(client, evt) {
    const info = this.#lifecycleInfo(evt)
    if (!info || !info.pubkey) return
    const key = info.x + '\0' + info.d
    this.#cancelWill(key)
    if (info.left) {
      client.lifecycle.delete(key); client.beaconed.delete(key)
      if (client.drainZone?.x === info.x) client.drainZone = null
      return
    }
    client.beaconed.add(key)
    client.lifecycle.set(key, { x: info.x, d: info.d, pubkey: info.pubkey })
    // The drained word's zone: this connection's newest {alive}, and only it.
    if (HEX64.test(info.x)) {
      client.drainZone = { x: info.x, exp: expirationOf(evt) || (Number(evt.created_at) + LIFECYCLE_DEFAULT_TTL) }
      this.#releaseHeldAsks(client)
    }
    // Alive on THIS connection: a will another connection still holds for the
    // slot is a refreshed tab's old socket, not yet reaped — never fire it.
    for (const other of this.#clients) if (other !== client) other.lifecycle.delete(key)
  }

  #willHeir(key, except) {
    for (const c of this.#clients) if (c !== except && !c.closed && c.beaconed.has(key)) return c
    return null
  }

  #armWills(client) {
    for (const [key, will] of client.lifecycle) {
      const heir = this.#willHeir(key, client)
      if (heir) { if (!heir.lifecycle.has(key)) heir.lifecycle.set(key, will); continue }
      const held = this.#pendingWills.get(key)
      if (held) this.#clearTimer(held.timer)
      this.#pendingWills.set(key, { ...will, timer: this.#setTimer(() => this.#fireWill(key), this.#willGraceMs) })
    }
    client.lifecycle.clear()
  }

  #fireWill(key) {
    const will = this.#pendingWills.get(key)
    if (!will) return
    this.#pendingWills.delete(key)
    const heir = this.#willHeir(key, null)
    if (heir) { if (!heir.lifecycle.has(key)) heir.lifecycle.set(key, { x: will.x, d: will.d, pubkey: will.pubkey }); return }
    const nowSec = Math.floor(this.#now() / 1000)
    const tomb = {
      pubkey: will.pubkey, created_at: nowSec, kind: LIFECYCLE_KIND,
      tags: [['x', will.x], ['d', will.d], ['expiration', String(nowSec + LIFECYCLE_WILL_TTL)]],
      content: JSON.stringify({ left: true }),
    }
    tomb.id = eventId(tomb)
    tomb.sig = ''  // made by the meeting point (see above)
    try { this.#insert(tomb) } catch {}
    this.#broadcast(tomb, null)
    this.#census.willsFired++
  }

  #cancelWill(key) {
    const will = this.#pendingWills.get(key)
    if (!will) return
    this.#clearTimer(will.timer)
    this.#pendingWills.delete(key)
    this.#census.willsCancelled++
  }
}
