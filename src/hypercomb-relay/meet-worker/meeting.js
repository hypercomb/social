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
// travel by replication to a host (the R2 PUT at pluginthematrix.com) — bar
// the content broker's answers, which are kept one per sig for the 15
// minutes a reader can ask for them, and are the first thing a full store
// lets go. A full store never refuses presence while it can make room.
// Nothing is kept for good (presence 5 minutes at most, anything else a
// week), and no one source holds more than its share of the store or more
// than its share of the sockets ("what one stranger can hold", below).
//
// Ported from relay.js (the home relay), behaviour for behaviour: the hc:host
// first frame, NIP-01/33 slots, NIP-40 expiry, the per-connection token
// buckets (one for bulk kinds, one for the rest) under a per-address ceiling,
// the 200-subscription cap, the room-scoped drain
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
/** What the object keeps in memory before it makes room or refuses. One
 *  isolate has 128 MB; the rest is sockets, subscriptions and the runtime. */
export const STORE_MAX_BYTES = 64 * 1024 * 1024
/** An event is COUNTED as its JSON plus this: the heap it really costs (the
 *  record, its strings, its index entries). Counted as JSON alone, a store
 *  "full" of 200-byte events was 140 MB of heap — past the isolate, which
 *  would have died, every room with it, before it ever said full. */
export const EVENT_OVERHEAD_BYTES = 600
/** The swarm's presence: who is here (30206), the pages they show (30200),
 *  where they are (30204) and what they hold back (30208). Never refused
 *  while anything can be evicted, and the last STORE_RESERVE_BYTES of the
 *  store are theirs alone — a store that fills up never makes a newcomer
 *  invisible or a new page unwalkable. */
export const PRESENCE_KINDS = new Set([30200, 30204, 30206, 30208])
export const STORE_RESERVE_BYTES = 4 * 1024 * 1024
/** The content broker's answer: content-addressed bytes the asker sha256-
 *  checks, so any holder's copy is as good as another's — ONE holder's WHOLE
 *  run is kept per address and type (the asker assembles a chunked answer
 *  from one key's chunks, so a mix of holders never completes), exactly as
 *  relay.js keeps it — and readers ask with since = now − 900, so it is kept
 *  ANSWER_STORE_SECS at most, whatever expiration it carries (the broker
 *  stamps a day). Only a run a reader can assemble is kept (d = x, or d = x#i
 *  with c = i/n, n ≤ ANSWER_CHUNKS_MAX), at most ANSWERS_PER_ADDRESS_MAX per
 *  address, never one dated more than ANSWER_FUTURE_SECS ahead, and a run of
 *  bytes becomes THE run only once it hashes to its address: a forged copy
 *  never pins a popular picture's replay. Everything else is fanned out, not
 *  kept. A full store evicts answers first, oldest first. */
export const ANSWER_KIND = 30401
export const ANSWER_STORE_SECS = 900
export const ANSWER_CHUNKS_MAX = 64
export const ANSWERS_PER_ADDRESS_MAX = 128
export const ANSWER_FUTURE_SECS = 60
/** What the broker answers: a layer, a resource, a location's visuals. */
const ANSWER_TYPES = new Set(['layer', 'resource', 'visuals'])
/** Bulk: the broker's answers, ask and cancel and the swarm's resource
 *  bytes. They draw on their OWN bucket, so a sharer whose pictures are in
 *  demand never has its own beacon or page refused for answering. */
export const BULK_KINDS = new Set([ANSWER_KIND, 30201, 20400, 20402])
/** A Worker cannot send a protocol ping, so a socket whose path died without
 *  a FIN is found by its silence: every live client probes at least every
 *  30 s (hidden) and a throttled hidden tab about once a minute. */
export const REAP_IDLE_MS = 120_000
export const WILL_GRACE_MS = 15_000
/** An heir heard within this long counts as there, whenever the dying
 *  connection last beaconed: past a throttled hidden tab's minute cadence
 *  (it cannot be pinged — see above), short of the silence a locked phone's
 *  zombie socket keeps before the reap. */
export const HEIR_HEARD_MS = 90_000
export const LIFECYCLE_KIND = 30206
const LIFECYCLE_WILL_TTL = 300   // seconds a synthesized tombstone lingers for late joiners
const FUTURE_SKEW_SECS = 15 * 60

// The per-connection budget and the per-address ceiling (relay.js "AN IP IS
// NOT ONE PARTICIPANT"): EVENT and REQ cost one token; CLOSE never does. A
// connection has two buckets of these sizes — one for BULK_KINDS, one for
// everything else — and both draw on the one ceiling for its address.
export const BUCKETS = { connBurst: 400, connPerSec: 10, ipBurst: 12_000, ipPerSec: 200 }

// ── what one stranger can hold (2026-10-11, the open default) ────────────────
//
// wss://hypercomb.com takes every install with no code, so nothing here may be
// something one sender can fill, pin or outlast. The code was never the
// barrier for these either: every guest of every coded meeting shares one.
//
// NOTHING IS KEPT FOR GOOD. Every kept event's stored life has a ceiling,
// whatever expiration it carries (or none): presence PRESENCE_STORE_SECS (the
// swarm beacons a 90–120 s life every 30–90 s; a will's tombstone lives 300
// s), every other kind STORE_LIFE_MAX_SECS — the longest any shipped client
// asks for (feedback items and the install roster, 7 days; resource bytes a
// day). So every kept event is in an eviction tier, and a far-future beacon
// can never outlast a real one by more than a few minutes.
export const PRESENCE_STORE_SECS = 300
export const STORE_LIFE_MAX_SECS = 7 * 86_400
// ONE SOURCE'S SHARE. Each kept event is charged to its SOURCE — the sender's
// address, IPv6 by its /64 (sourceOf) — and one source holds at most
// 1/SOURCE_STORE_SHARE of the store: past it, its OWN oldest events make room
// (answers and other kinds first; its presence only for its presence), never
// anyone else's. One machine can never fill the store, so it can never make a
// later beacon from anyone else come back full.
export const SOURCE_STORE_SHARE = 8
// A non-bulk event this large is fanned out but never kept: no page, beacon or
// item the swarm writes comes near it (a page names its tiles' signatures),
// and bytes ride the bulk kinds.
export const STORED_EVENT_MAX_BYTES = 128 * 1024
// SOCKETS. A socket costs the isolate memory whether it speaks or not, so one
// source holds at most MAX_SOCKETS_PER_SOURCE at once (a household, an office
// behind one NAT, a refreshing tab's zombie), and the object at most
// MAX_SOCKETS, routing at most MAX_LIVE_ADDRESSES subscribed addresses in all
// (about 350 bytes of heap each). Past either ceiling a dial is closed BUSY
// (1013) and a REQ is CLOSED full: refused, never the isolate's 128 MB — which
// would drop every room at once.
export const MAX_SOCKETS_PER_SOURCE = 32
export const MAX_SOCKETS = 2_500
export const MAX_LIVE_ADDRESSES = 50_000
// The lifecycle slots one connection beacons (its wills): a participant is in
// one room, a few while moving between them.
export const MAX_LIFECYCLE_PER_CONNECTION = 16

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/

/** The source a connection is counted as: its IPv4 address, or its IPv6 /64 —
 *  the prefix one subscriber or one server holds whole and can rotate through
 *  at will. '' (no address known) is one source like any other. */
export function sourceOf(ip) {
  const raw = String(ip || '').trim().toLowerCase()
  if (!raw.includes(':')) return raw
  const mapped = IPV4_MAPPED.exec(raw)
  if (mapped) return mapped[1]
  const [head, tail] = raw.split('::')
  const front = head ? head.split(':') : []
  const back = tail ? tail.split(':') : []
  const groups = tail === undefined ? front : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back]
  return groups.slice(0, 4).map((g) => (g || '0').replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

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

/** A broker answer's place in a run a reader can assemble — { xt, x, t, i, n }
 *  — or null: then it is fanned out, never kept. */
function answerShape(evt) {
  const x = String(tagValue(evt, 'x') ?? '')
  if (!HEX64.test(x)) return null
  const t = String(tagValue(evt, 't') ?? '')
  if (!ANSWER_TYPES.has(t)) return null
  const d = dTagOf(evt)
  const c = tagValue(evt, 'c')
  if (c === undefined) return d === x ? { xt: `${x}\0${t}`, x, t, i: 0, n: 1 } : null
  const m = /^(\d{1,3})\/(\d{1,3})$/.exec(String(c))
  if (!m) return null
  const i = Number(m[1])
  const n = Number(m[2])
  if (n < 2 || n > ANSWER_CHUNKS_MAX || i >= n || d !== `${x}#${i}`) return null
  return { xt: `${x}\0${t}`, x, t, i, n }
}

/** Do a run's chunks (base64, in order) hash to its address? */
function runHashesTo(contents, x) {
  try {
    const hash = sha256.create()
    for (const content of contents) {
      const bin = atob(String(content))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      hash.update(bytes)
    }
    return bytesToHex(hash.digest()) === x
  } catch { return false }
}

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
  #storeReserveBytes
  #reapIdleMs
  #willGraceMs
  #buckets
  #sourceStoreMaxBytes
  #storedEventMaxBytes
  #maxSockets
  #maxSocketsPerSource
  #maxLiveAddresses

  #clients = new Set()
  #socketsBySource = new Map()  // source → open connections
  #liveAddresses = 0       // addresses routed across every connection
  #events = new Map()      // id → stored event
  #sizes = new Map()       // id → bytes it costs the store
  #untils = new Map()      // id → second its stored life ends (every kept event has one)
  #sourceOfId = new Map()  // id → the source it is charged to
  #idsBySource = new Map() // source → Set<id>, oldest kept first
  #bytesBySource = new Map() // source → bytes it holds
  // What a full store may evict, in the order it does (#makeRoom):
  #answers = new Set()     // broker answers, oldest first
  #othersByMinute = new Map()   // minute its life ends → Set<id>: other kinds that expire
  #presenceByMinute = new Map() // minute its life ends → Set<id>: presence slots that expire
  #storedBytes = 0
  #slots = new Map()       // pubkey\0kind\0d → id of the replaceable event held
  #answersAt = new Map()   // x\0t → { count, runs: Map<pubkey, { n, parts: Map<i, id> }>, whole: pubkey | '' }
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
    // 4 MB of 64 MB; a test's small store keeps the same 1/16.
    this.#storeReserveBytes = options.storeReserveBytes ?? Math.min(STORE_RESERVE_BYTES, Math.floor(this.#storeMaxBytes / 16))
    this.#reapIdleMs = options.reapIdleMs ?? REAP_IDLE_MS
    this.#willGraceMs = options.willGraceMs ?? WILL_GRACE_MS
    this.#buckets = { ...BUCKETS, ...(options.buckets ?? {}) }
    // 8 MB of 64 MB; a test's small store keeps the same 1/8.
    this.#sourceStoreMaxBytes = options.sourceStoreMaxBytes ?? Math.floor(this.#storeMaxBytes / SOURCE_STORE_SHARE)
    this.#storedEventMaxBytes = options.storedEventMaxBytes ?? STORED_EVENT_MAX_BYTES
    this.#maxSockets = options.maxSockets ?? MAX_SOCKETS
    this.#maxSocketsPerSource = options.maxSocketsPerSource ?? MAX_SOCKETS_PER_SOURCE
    this.#maxLiveAddresses = options.maxLiveAddresses ?? MAX_LIVE_ADDRESSES
  }

  static #freshCensus() {
    return { refusedEvents: 0, refusedReqs: 0, refusedSubs: 0, refusedDials: 0, unaddressed: 0, refusedFull: 0, evicted: 0, handlerErrors: 0, willsFired: 0, willsCancelled: 0, reaped: 0 }
  }

  get size() { return this.#clients.size }
  get pendingWills() { return this.#pendingWills.size }
  get storedEvents() { return this.#events.size }
  get storedBytes() { return this.#storedBytes }
  get liveAddresses() { return this.#liveAddresses }
  /** Bytes the store holds for `ip`'s source. */
  storedBytesOf(ip) { return this.#bytesBySource.get(sourceOf(ip)) ?? 0 }

  /** Why a dial from `ip` is not let in — the object's socket ceiling or its
   *  source's — or null. Asked before the socket is accepted. */
  refusal(ip) {
    let why = null
    if (this.#clients.size >= this.#maxSockets) why = 'busy: the meeting point is full — try again shortly'
    else if ((this.#socketsBySource.get(sourceOf(ip)) ?? 0) >= this.#maxSocketsPerSource) why = `busy: at most ${this.#maxSocketsPerSource} connections from one address`
    if (why) this.#census.refusedDials++
    return why
  }

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
    const source = sourceOf(ip)
    this.#socketsBySource.set(source, (this.#socketsBySource.get(source) ?? 0) + 1)
    const client = {
      socket, ip, source, closed: false, lastInboundMs: now,
      // beaconed: lifecycle slot → when this connection last beaconed it
      subs: new Map(), routes: new Map(), lifecycle: new Map(), beaconed: new Map(),
      bucket: { tokens: this.#buckets.connBurst, at: now },
      bulk: { tokens: this.#buckets.connBurst, at: now },
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

  /** One frame. A throw is this frame's NOTICE and a count, never the meeting.
   *  Only a frame that pays a token (an EVENT or REQ the budget took) counts
   *  as hearing from the socket: a CLOSE, a malformed frame or a refused one
   *  never keeps an idle socket from the reap, so holding a socket open costs
   *  what every live client already spends on its liveness probe. */
  message(client, raw) {
    if (!client || client.closed) return
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
    const left = (this.#socketsBySource.get(client.source) ?? 1) - 1
    if (left > 0) this.#socketsBySource.set(client.source, left)
    else this.#socketsBySource.delete(client.source)
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
      + `${c.refusedSubs ? ` subs ${c.refusedSubs}` : ''}${c.refusedDials ? ` dials ${c.refusedDials}` : ''}${c.unaddressed ? ` unaddressed ${c.unaddressed}` : ''}`
      + `${c.refusedFull ? ` full ${c.refusedFull}` : ''}${c.evicted ? ` · evicted ${c.evicted}` : ''}${c.handlerErrors ? ` · handler errors ${c.handlerErrors}` : ''}`
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
    if (!this.#takeToken(client, type === 'EVENT' && BULK_KINDS.has(msg[1]?.kind))) {
      if (type === 'EVENT') { this.#census.refusedEvents++; this.#send(client, ['OK', msg[1]?.id ?? '', false, 'rate-limited: slow down']) }
      else { this.#census.refusedReqs++; this.#send(client, ['CLOSED', String(msg[1] ?? ''), 'rate-limited: slow down']) }
      return
    }
    client.lastInboundMs = this.#now()
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
    // that beaconed that slot — the participant, still here — and that
    // connection TAKES the will (relay.js adoptWill): cancelled outright, its
    // own later death would leave no leave to fire.
    if (this.#pendingWills.size) for (const key of client.beaconed.keys()) this.#adoptWill(client, key)

    const verdict = this.#insert(evt, client.source)
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
    if (this.#liveAddresses - (client.routes.get(subId)?.xs.size ?? 0) + asked > this.#maxLiveAddresses) {
      client.subs.delete(subId)
      this.#unroute(client, subId)
      this.#census.refusedSubs++
      this.#send(client, ['CLOSED', subId, 'error: the meeting point is full — try again shortly'])
      return
    }
    client.subs.set(subId, filters)
    this.#route(client, subId, filters)
    // limit:0 asks for nothing stored — a live-only listen.
    if (!filters.every((f) => f.limit === 0)) for (const evt of this.#query(filters)) this.#send(client, ['EVENT', subId, evt])
    this.#send(client, ['EOSE', subId])
  }

  // ── store ──────────────────────────────────────────────────────────────────

  /** 'stored' | 'duplicate' | 'stale' | 'ephemeral' | 'unaddressed' | 'passing' | 'full'
   *  `source` is who the kept event is charged to (sourceOf its sender). */
  #insert(evt, source = '') {
    const kind = evt.kind
    if (isEphemeralKind(kind)) return 'ephemeral'
    if (this.#events.has(evt.id)) return 'duplicate'
    // No read can reach an event that names no signature: keep nothing.
    if (addressesOf(evt).size === 0) return 'unaddressed'
    // A broker answer lives here only while a reader's REQ (since = now −
    // 900) can still reach it; one already past that is fanned out, not kept.
    const nowSec = Math.floor(this.#now() / 1000)
    const presence = PRESENCE_KINDS.has(kind)
    let until = expirationOf(evt)
    if (kind === ANSWER_KIND) {
      const life = Math.min(evt.created_at, nowSec) + ANSWER_STORE_SECS
      until = until ? Math.min(until, life) : life
      if (until < nowSec || evt.created_at > nowSec + ANSWER_FUTURE_SECS) return 'passing'
      if (this.#answerNotKept(evt)) return 'passing'
    } else {
      // Nothing is kept for good (above): the ceiling, whatever it carries.
      const ceiling = nowSec + (presence ? PRESENCE_STORE_SECS : STORE_LIFE_MAX_SECS)
      until = until ? Math.min(until, ceiling) : ceiling
    }
    const slotted = isAddressableKind(kind) || isReplaceableKind(kind)
    const key = slotted ? slotKey(evt, kind) : null
    const heldId = key ? this.#slots.get(key) : undefined
    const held = heldId ? this.#events.get(heldId) : undefined
    // NIP-01: one event per slot — the newest; on equal created_at the lowest
    // id. An older ANSWER is still fanned out (not kept): any holder's bytes
    // are as good, and a future-dated copy in the slot must never silence the
    // live answers of the holders who came after it.
    if (held && (held.created_at > evt.created_at || (held.created_at === evt.created_at && held.id < evt.id))) return kind === ANSWER_KIND ? 'passing' : 'stale'
    const rec = { id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, kind, tags: evt.tags, content: evt.content, sig: evt.sig }
    const size = JSON.stringify(rec).length + EVENT_OVERHEAD_BYTES
    // Too large to keep (above): fanned out — and the publisher's older copy
    // in the slot goes, so nobody replays what it has replaced.
    if (size > this.#storedEventMaxBytes && !BULK_KINDS.has(kind)) {
      if (heldId) this.#drop(heldId)
      return 'passing'
    }
    const heldSize = heldId ? this.#sizes.get(heldId) ?? 0 : 0
    // The source's share first, from its own events only; then the store.
    const mine = (this.#bytesBySource.get(source) ?? 0) - (heldId && this.#sourceOfId.get(heldId) === source ? heldSize : 0)
    const overMine = mine + size - this.#sourceStoreMaxBytes
    if (overMine > 0 && !this.#makeRoomFrom(source, overMine, presence, heldId)) return 'full'
    const over = this.#storedBytes - heldSize + size
      - (this.#storeMaxBytes - (presence ? 0 : this.#storeReserveBytes))
    if (over > 0 && !this.#makeRoom(over, presence, heldId)) return 'full'
    if (heldId) this.#drop(heldId)
    if (key) this.#slots.set(key, evt.id)
    this.#events.set(rec.id, rec)
    this.#sizes.set(rec.id, size)
    this.#storedBytes += size
    this.#sourceOfId.set(rec.id, source)
    indexAdd(this.#idsBySource, source, rec.id)
    this.#bytesBySource.set(source, (this.#bytesBySource.get(source) ?? 0) + size)
    for (const x of addressesOf(rec)) indexAdd(this.#idsByX, x, rec.id)
    if (kind === ANSWER_KIND) this.#answers.add(rec.id)
    else indexAdd(presence ? this.#presenceByMinute : this.#othersByMinute, Math.floor(until / 60), rec.id)
    this.#untils.set(rec.id, until)
    if (kind === ANSWER_KIND) this.#answerStored(rec)
    return 'stored'
  }

  // ── broker answers: one holder's whole run per address and type ───────────
  //
  // Kept as running counts (#answersAt), so a store costs O(1) whatever is
  // held at the address — never a rescan of it.

  /** True when an answer is fanned out but not kept: shaped as no run a
   *  reader can assemble, another holder's whole run already kept here, or
   *  the address full. */
  #answerNotKept(evt) {
    const shape = answerShape(evt)
    if (!shape) return true
    const at = this.#answersAt.get(shape.xt)
    if (!at) return false
    if (at.whole && at.whole !== evt.pubkey) return true
    return at.count >= ANSWERS_PER_ADDRESS_MAX && !at.runs.get(evt.pubkey)?.parts.has(shape.i)
  }

  /** A kept answer joins its holder's run; once that run is whole (and, for
   *  bytes, hashes to its address) it is the only one kept here. */
  #answerStored(rec) {
    const shape = answerShape(rec)
    if (!shape) return
    const older = this.#answersAt.get(shape.xt)?.runs.get(rec.pubkey)
    // re-chunked: the holder's older run is not this one
    if (older && older.n !== shape.n) for (const id of [...older.parts.values()]) this.#drop(id)
    let at = this.#answersAt.get(shape.xt)
    if (!at) this.#answersAt.set(shape.xt, at = { count: 0, runs: new Map(), whole: '' })
    let run = at.runs.get(rec.pubkey)
    if (!run) { run = { n: shape.n, parts: new Map() }; at.runs.set(rec.pubkey, run) }
    if (!run.parts.has(shape.i)) at.count++
    run.parts.set(shape.i, rec.id)
    if (run.parts.size !== run.n || at.whole) return
    // A location's visuals carry no byte address (the asker checks each event
    // they pack); every other answer's bytes must hash to it.
    if (shape.t !== 'visuals') {
      const contents = []
      for (let i = 0; i < run.n; i++) contents.push(this.#events.get(run.parts.get(i))?.content ?? '')
      if (!runHashesTo(contents, shape.x)) {
        for (const id of [...run.parts.values()]) this.#drop(id)
        return
      }
    }
    at.whole = rec.pubkey
    for (const [pubkey, other] of [...at.runs]) if (pubkey !== rec.pubkey) for (const id of [...other.parts.values()]) this.#drop(id)
  }

  /** An answer left the store (replaced, expired, evicted, or another run won). */
  #answerDropped(rec) {
    const shape = answerShape(rec)
    if (!shape) return
    const at = this.#answersAt.get(shape.xt)
    const run = at?.runs.get(rec.pubkey)
    if (!run || run.parts.get(shape.i) !== rec.id) return
    run.parts.delete(shape.i)
    at.count--
    if (run.parts.size === 0) at.runs.delete(rec.pubkey)
    if (at.whole === rec.pubkey) at.whole = ''
    if (at.count === 0) this.#answersAt.delete(shape.xt)
  }

  /** Free `need` bytes, or nothing at all: broker answers oldest first, then
   *  other kinds, soonest-ending first (to the minute), and presence slots
   *  last and only to make room for presence. Never `keep` (the slot being
   *  replaced). Every kept event has a stored life (the ceilings above), so
   *  every one is in a tier. It walks only as far as it takes. False: the
   *  store is truly full. */
  #makeRoom(need, presence, keep) {
    const victims = []
    let found = 0
    const take = (ids) => {
      for (const id of ids) {
        if (found >= need) return
        if (id !== keep) { victims.push(id); found += this.#sizes.get(id) ?? 0 }
      }
    }
    take(this.#answers)
    for (const tier of presence ? [this.#othersByMinute, this.#presenceByMinute] : [this.#othersByMinute]) {
      if (found >= need) break
      for (const minute of [...tier.keys()].sort((a, b) => a - b)) {
        take(tier.get(minute))
        if (found >= need) break
      }
    }
    if (found < need) return false
    for (const id of victims) this.#drop(id)
    this.#census.evicted += victims.length
    return true
  }

  /** Free `need` bytes of ONE source's share from its own events, or nothing
   *  at all: its answers and other kinds first, oldest kept first, then — only
   *  to make room for its presence — its presence. Never `keep`. */
  #makeRoomFrom(source, need, presence, keep) {
    const ids = this.#idsBySource.get(source)
    if (!ids) return false
    const victims = []
    let found = 0
    for (const pass of presence ? [false, true] : [false]) {
      for (const id of ids) {
        if (found >= need) break
        if (id === keep || PRESENCE_KINDS.has(this.#events.get(id)?.kind) !== pass) continue
        victims.push(id)
        found += this.#sizes.get(id) ?? 0
      }
    }
    if (found < need) return false
    for (const id of victims) this.#drop(id)
    this.#census.evicted += victims.length
    return true
  }

  #drop(id) {
    const rec = this.#events.get(id)
    if (!rec) return
    this.#events.delete(id)
    const size = this.#sizes.get(id) ?? 0
    this.#storedBytes -= size
    this.#sizes.delete(id)
    const source = this.#sourceOfId.get(id)
    if (source !== undefined) {
      this.#sourceOfId.delete(id)
      indexDrop(this.#idsBySource, source, id)
      const left = (this.#bytesBySource.get(source) ?? 0) - size
      if (left > 0) this.#bytesBySource.set(source, left)
      else this.#bytesBySource.delete(source)
    }
    const until = this.#untils.get(id)
    this.#untils.delete(id)
    if (rec.kind === ANSWER_KIND) this.#answers.delete(id)
    else if (until) indexDrop(PRESENCE_KINDS.has(rec.kind) ? this.#presenceByMinute : this.#othersByMinute, Math.floor(until / 60), id)
    for (const x of addressesOf(rec)) indexDrop(this.#idsByX, x, id)
    if (isAddressableKind(rec.kind) || isReplaceableKind(rec.kind)) {
      const key = slotKey(rec, rec.kind)
      if (this.#slots.get(key) === id) this.#slots.delete(key)
    }
    if (rec.kind === ANSWER_KIND) this.#answerDropped(rec)
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
        const until = this.#untils.get(id)
        if (until && until < nowSec) continue  // NIP-40: never replay an expired beacon, even before the sweep
        if (matchFilter(f, evt)) { hits.push(evt); seen.add(id) }
      }
      hits.sort((a, b) => b.created_at - a.created_at)
      results.push(...hits.slice(0, Math.min(f.limit ?? 500, MAX_LIMIT)))
    }
    return results.slice(0, MAX_LIMIT)
  }

  #deleteExpired(nowSec) {
    for (const [id, until] of this.#untils) if (until < nowSec) this.#drop(id)
  }

  // ── budgets ────────────────────────────────────────────────────────────────

  #takeToken(client, bulk) {
    const now = this.#now()
    const b = this.#buckets
    const own = bulk ? client.bulk : client.bucket
    let venue = this.#ipBuckets.get(client.source)
    if (!venue) { venue = { tokens: b.ipBurst, at: now }; this.#ipBuckets.set(client.source, venue) }
    const refill = (bucket, burst, perSec) => {
      bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * perSec / 1000)
      bucket.at = now
    }
    refill(own, b.connBurst, b.connPerSec)
    refill(venue, b.ipBurst, b.ipPerSec)
    if (own.tokens < 1 || venue.tokens < 1) return false
    own.tokens--
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
    this.#liveAddresses += xs.size
  }

  #unroute(client, subId) {
    const route = client.routes.get(subId)
    if (!route) return
    client.routes.delete(subId)
    this.#liveAddresses -= route.xs.size
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
    // The event is serialized ONCE and each subscription id spliced in: a
    // reconnect herd's beacons reach every member, and serializing per
    // subscriber made that cost grow with the square of the room.
    let body = null
    for (const { client: c, subId } of candidates) {
      if (c === source || c.closed) continue
      const filters = c.subs.get(subId)
      if (!filters || !matchesAny(filters, evt)) continue
      body ??= JSON.stringify(evt)
      try { c.socket.send(`["EVENT",${JSON.stringify(subId)},${body}]`) } catch {}
    }
  }

  // ── soft wills ─────────────────────────────────────────────────────────────
  //
  // A tab that dies cannot send its own {left}. The meeting point remembers
  // the last {alive} beacon each connection published in a slot (x = zone, d
  // = pubkey) and, when the socket dies, tombstones it — but only after a
  // GRACE: a reload, a network hop or a NAT rebind kills a socket while the
  // person is still there. Any {alive}/{left} on the slot, or any verified
  // EVENT on a connection that beaconed it, hands the will to that connection
  // (it is still here); another open connection that beaconed the slot
  // inherits it instead — but only one HEARD FROM since the dying
  // connection's newest beacon for the slot, or within HEIR_HEARD_MS. A phone
  // that locked without a FIN leaves a silent socket until the reap; when its
  // wake's socket dies too, a zombie silent that long must not hold the will
  // for the minutes the reap takes, while a throttled hidden tab of the same
  // key (heard once a minute) still does. The tombstone is unsigned (the
  // meeting point cannot sign as the participant) and can only remove a
  // peer's tiles, never add content.

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
    // Newest last, and at most MAX_LIFECYCLE_PER_CONNECTION of each: the
    // oldest slot a connection beaconed is forgotten first.
    client.beaconed.delete(key)
    client.beaconed.set(key, this.#now())
    client.lifecycle.delete(key)
    client.lifecycle.set(key, { x: info.x, d: info.d, pubkey: info.pubkey })
    for (const map of [client.beaconed, client.lifecycle]) {
      while (map.size > MAX_LIFECYCLE_PER_CONNECTION) map.delete(map.keys().next().value)
    }
    // The drained word's zone: this connection's newest {alive}, and only it.
    if (HEX64.test(info.x)) {
      client.drainZone = { x: info.x, exp: expirationOf(evt) || (Number(evt.created_at) + LIFECYCLE_DEFAULT_TTL) }
      this.#releaseHeldAsks(client)
    }
    // Alive on THIS connection: a will another connection still holds for the
    // slot is a refreshed tab's old socket, not yet reaped — never fire it.
    for (const other of this.#clients) if (other !== client) other.lifecycle.delete(key)
  }

  /** An open connection that beaconed the slot and is still THERE: spoken
   *  since `since` (the dying connection's newest beacon for the slot), or
   *  within HEIR_HEARD_MS — a hidden second tab, throttled to a frame a
   *  minute and never pinged (a Worker cannot), must not lose the will to a
   *  beacon it did not happen to follow. */
  #willHeir(key, except, since) {
    const heard = Math.min(since, this.#now() - HEIR_HEARD_MS)
    for (const c of this.#clients) if (c !== except && !c.closed && c.beaconed.has(key) && c.lastInboundMs >= heard) return c
    return null
  }

  #armWills(client) {
    for (const [key, will] of client.lifecycle) {
      const since = client.beaconed.get(key) ?? 0
      const heir = this.#willHeir(key, client, since)
      if (heir) { if (!heir.lifecycle.has(key)) heir.lifecycle.set(key, will); continue }
      const held = this.#pendingWills.get(key)
      if (held) this.#clearTimer(held.timer)
      // The tombstone is charged to the source whose connection died.
      this.#pendingWills.set(key, { ...will, since, source: client.source, timer: this.#setTimer(() => this.#fireWill(key), this.#willGraceMs) })
    }
    client.lifecycle.clear()
  }

  #fireWill(key) {
    const will = this.#pendingWills.get(key)
    if (!will) return
    this.#pendingWills.delete(key)
    // Asked again at the end of the grace: a second tab that has spoken since
    // inherits; a zombie that has not, does not.
    const heir = this.#willHeir(key, null, will.since)
    if (heir) { if (!heir.lifecycle.has(key)) heir.lifecycle.set(key, { x: will.x, d: will.d, pubkey: will.pubkey }); return }
    const nowSec = Math.floor(this.#now() / 1000)
    const tomb = {
      pubkey: will.pubkey, created_at: nowSec, kind: LIFECYCLE_KIND,
      tags: [['x', will.x], ['d', will.d], ['expiration', String(nowSec + LIFECYCLE_WILL_TTL)]],
      content: JSON.stringify({ left: true }),
    }
    tomb.id = eventId(tomb)
    tomb.sig = ''  // made by the meeting point (see above)
    try { this.#insert(tomb, will.source ?? '') } catch {}
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

  /** A connection of the slot spoke during the grace: the will is its own. */
  #adoptWill(client, key) {
    const will = this.#pendingWills.get(key)
    if (!will) return
    this.#cancelWill(key)
    if (!client.lifecycle.has(key)) client.lifecycle.set(key, { x: will.x, d: will.d, pubkey: will.pubkey })
  }
}
