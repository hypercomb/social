// hypercomb-meet — THE ALWAYS-ONLINE MEETING POINT
// (documentation/swarm-host.md, "The always-online meeting point").
//
// jwize, 2026-10-09: "the swarm needs to be resilient through refreshes and we
// need a host to use that is always online". The home relay (relay.js) stops
// whenever its machine, service or tunnel does; this is the same meeting half
// with no machine under it: ONE Durable Object holding every socket, reached
// at wss://pluginthematrix.com through pluginthematrix-core's service binding
// (that worker keeps the bytes: PUT /<sig> → R2). The meeting link names it —
// it is never a shipped default.
//
// ONE OBJECT, MEMORY ONLY. Every connection of every room is in one place, so
// fan-out, the room-scoped drain and the will heir work exactly as they do in
// relay.js (meeting.js is that protocol). The sockets use the WebSocket
// Hibernation API (acceptWebSocket, getWebSockets), and the object keeps a
// sweep timer armed while any socket is open — a pending timer is what keeps
// an object from hibernating, so the room's slots stay in memory for as long
// as anyone is in it. With the last socket gone the timer stops and the
// object may be evicted: a reset is a relay restart (every socket closes, the
// client's reconnect ladder brings the room back in seconds, heartbeats refill
// the slots). If the runtime ever wakes the object without its memory, the
// sockets it still holds are closed with 1012 so each client re-subscribes.
//
// THE ACCESS CODE (jwize: "Just allow an access code that can be recycled").
// A dial carries the code as a WebSocket subprotocol, `hc-access.<code>`, so
// it costs no round trip. The object keeps only sha256(current code), in its
// own private storage — never a var, a pool, a resource or a log. A dial whose
// code does not hash to it is accepted and closed at once with 4401 and no
// data (a browser cannot read an HTTP status on a refused upgrade; a close
// code it can). RECYCLING: an operator key (env OPERATOR_KEYS) POSTs the NEW
// code's hash, NIP-98 signed, to /.well-known/hc-meet/code. It is in force the
// moment it is stored — no restart, no redeploy — and every socket that came
// in on the old code is closed with 4401 at once (becoming-a-host.md: "A host
// can destroy an old key at any time"). `{ "close": true }` destroys the code
// without a successor: nobody joins until a new one is set. A fresh object has
// no code, so it is closed until its operator sets the first.

import { Meeting, HEX64, sha256Hex } from './meeting.js'
import { ACCESS_REFUSED, CODE_PATH, checkRecycle, codeOpens, offeredAccess, operatorKeys, refuseDial, sameDigest, wellFormedCode } from './access.js'

const RESTARTED = 1012
const OBJECT_NAME = 'meet'
// The router's own question to the object: the hash in force. Never forwarded
// from outside — the router answers 404 to any request for it — so the hash
// stays where it is kept, and in each isolate's memory, nowhere else.
const DOOR_PATH = '/.well-known/hc-meet/door'
const DOOR_REFRESH_MS = 1_000
const RECYCLE_BODY_MAX = 1024
const SWEEP_MS = 15_000
const CENSUS_MS = 60_000

const CORS = { 'Access-Control-Allow-Origin': '*' }
const text = (status, body, headers = {}) =>
  new Response(body + '\n', { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS, ...headers } })
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } })

const isUpgrade = (request) => String(request.headers.get('upgrade') || '').toLowerCase() === 'websocket'
const wantsInfo = (request, url) => url.pathname === '/' && /application\/nostr\+json/i.test(request.headers.get('accept') || '')

function participantsOf(env) {
  const v = String(env?.PARTICIPANTS ?? '').trim().toLowerCase()
  return v === 'all' || v === 'zones' ? v : false
}

const positive = (raw, fallback) => { const n = Number(raw); return Number.isFinite(n) && n > 0 ? n : fallback }

// ── the meeting point ────────────────────────────────────────────────────────

export class MeetingPoint {
  #state
  #env
  #meeting
  #access = { hash: null, at: 0 }   // sha256(current code) and the created_at of the recycle that set it
  #clients = new Map()              // socket id (unique across incarnations) → meeting client
  #sweep = null
  #sinceCensus = 0                  // ms of sweeps since the last minute line

  constructor(state, env) {
    this.#state = state
    this.#env = env
    this.#meeting = new Meeting({
      participants: participantsOf(env),
      // HARNESS ONLY: a shorter will grace for the wrangler dev suite.
      willGraceMs: positive(env?.DIAG_WILL_GRACE_MS, undefined),
    })
    state.blockConcurrencyWhile(async () => {
      const held = await state.storage.get('access')
      if (held && (held.hash === null || HEX64.test(String(held.hash)))) this.#access = { hash: held.hash, at: Number(held.at) || 0 }
      // Constructed while sockets are still open: the runtime woke this
      // object without its memory. Their subscriptions are gone, so say so —
      // each client reconnects at once and asks again.
      for (const ws of state.getWebSockets()) try { ws.close(RESTARTED, 'restart: the meeting point lost its memory — reconnect') } catch {}
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (isUpgrade(request)) return this.#dial(request)
    if (url.pathname === DOOR_PATH && request.method === 'GET') return json(200, { hash: this.#access.hash })
    if (url.pathname === CODE_PATH) {
      if (request.method !== 'POST') return text(405, 'POST a NIP-98 signed { "hash": "<sha256 of the new code>" }')
      return this.#recycle(request)
    }
    if (wantsInfo(request, url)) {
      return new Response(JSON.stringify({
        name: 'hypercomb-meet',
        description: 'The always-online meeting point for Hypercomb swarms — a memory-only relay behind an access code',
        supported_nips: [1, 11, 33, 40],
        software: 'hypercomb-relay/meet-worker',
        version: '0.1.0',
        limitation: this.#meeting.limitation(),
      }), { status: 200, headers: { 'Content-Type': 'application/nostr+json', ...CORS } })
    }
    return text(404, 'not found')
  }

  #dial(request) {
    const offered = offeredAccess(request.headers.get('sec-websocket-protocol'))
    const headers = offered ? { 'Sec-WebSocket-Protocol': offered.token } : {}
    if (!codeOpens(offered?.code, this.#access.hash)) {
      // The object re-checks what the router let through: the router's copy
      // of the hash may be up to a second behind a recycle.
      return refuseDial(offered, !this.#access.hash ? 'access: the meeting point is closed'
        : offered ? 'access: code refused' : 'access: code required')
    }
    const [client, server] = Object.values(new WebSocketPair())
    const id = crypto.randomUUID()
    this.#state.acceptWebSocket(server)
    server.serializeAttachment({ id })
    const ip = request.headers.get('cf-connecting-ip') || ''
    this.#clients.set(id, this.#meeting.connect(server, { ip }))
    this.#armSweep()
    return new Response(null, { status: 101, webSocket: client, headers })
  }

  #clientOf(ws) {
    let id
    try { id = ws.deserializeAttachment()?.id } catch {}
    return id === undefined ? undefined : this.#clients.get(id)
  }

  #forget(ws) {
    let id
    try { id = ws.deserializeAttachment()?.id } catch {}
    const client = id === undefined ? undefined : this.#clients.get(id)
    if (client) { this.#clients.delete(id); this.#meeting.disconnect(client) }
    if (this.#meeting.size === 0) this.#disarmSweep()
  }

  webSocketMessage(ws, message) {
    const client = this.#clientOf(ws)
    if (!client) { try { ws.close(RESTARTED, 'restart: the meeting point lost its memory — reconnect') } catch {} ; return }
    this.#meeting.message(client, message)
  }

  webSocketClose(ws, code, reason) {
    this.#forget(ws)
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason) } catch {}
  }

  webSocketError(ws) {
    this.#forget(ws)
  }

  async #recycle(request) {
    const body = await request.text()
    if (body.length > RECYCLE_BODY_MAX) return text(413, 'a recycle body is a few bytes')
    const verdict = checkRecycle({
      url: request.url, method: 'POST', authorization: request.headers.get('authorization'), body,
      operators: operatorKeys(this.#env), nowSec: Math.floor(Date.now() / 1000), inForceAt: this.#access.at,
    })
    if (!verdict.ok) return text(verdict.status, verdict.reason)
    if (verdict.hash !== null && sameDigest(verdict.hash, this.#access.hash ?? '')) return json(200, { ok: true, unchanged: true, closed: 0 })
    this.#access = { hash: verdict.hash, at: verdict.at }
    await this.#state.storage.put('access', { hash: verdict.hash, at: verdict.at })
    // In force now: every socket in the room came in on the old code.
    const closed = this.#meeting.closeAll(ACCESS_REFUSED, verdict.hash ? 'access: code recycled' : 'access: the meeting point is closed')
    this.#clients.clear()
    this.#disarmSweep()
    return json(200, { ok: true, open: verdict.hash !== null, closed })
  }

  // The sweep runs while anyone is here: expiry, idle reap, the minute line.
  // Its pending timer is also what keeps the room's memory resident.
  #armSweep() {
    if (this.#sweep) return
    const every = positive(this.#env?.DIAG_SWEEP_MS, SWEEP_MS)
    this.#sweep = setInterval(() => {
      this.#meeting.sweep()
      for (const [id, client] of this.#clients) if (client.closed) this.#clients.delete(id)
      this.#sinceCensus += every
      if (this.#sinceCensus >= CENSUS_MS) { this.#sinceCensus = 0; this.#meeting.logCensus() }
      if (this.#meeting.size === 0) this.#disarmSweep()
    }, every)
  }

  #disarmSweep() {
    if (!this.#sweep) return
    clearInterval(this.#sweep)
    this.#sweep = null
  }
}

// ── the router ───────────────────────────────────────────────────────────────
//
// This script has no route of its own (wrangler.meet.toml): it is reached only
// through pluginthematrix-core's MEET service binding, which forwards the
// meeting host's WebSocket upgrades, its NIP-11 answer and the recycle path.
//
// THE DOOR STANDS IN FRONT OF THE OBJECT. The one object carries every room,
// and anyone on the internet can dial without a code — so a dial is refused
// HERE, in the stateless front, whenever it can be: one with no well-formed
// code never reaches the object at all, and a code is checked against this
// isolate's copy of the hash in force, asked of the object at most once a
// second (and at once, coalesced, when the copy is older). A flood of dials
// costs the meeting nothing but that one question per second per isolate.
// The object still checks every dial it is handed: the copy can be up to a
// second behind a recycle, and a recycle in this isolate forgets it at once.
let door = { hash: undefined, at: -Infinity, asking: null }

/** The hash in force (null: the door is shut), from this isolate's copy when
 *  it is under a second old, else asked of the object once for everyone. */
function hashInForce(stub) {
  if (door.hash !== undefined && Date.now() - door.at < DOOR_REFRESH_MS) return Promise.resolve(door.hash)
  door.asking ??= stub.fetch(new Request('https://meet.internal' + DOOR_PATH))
    .then((res) => res.json())
    .then((body) => {
      const hash = HEX64.test(String(body?.hash)) ? body.hash : null
      door = { hash, at: Date.now(), asking: null }
      return hash
    }, () => {
      door.asking = null
      return door.hash ?? null
    })
  return door.asking
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!isUpgrade(request) && !wantsInfo(request, url) && url.pathname !== CODE_PATH) return text(404, 'not found')
    const hint = String(env.LOCATION_HINT || '').trim()
    const stub = env.MEETING.get(env.MEETING.idFromName(OBJECT_NAME), hint ? { locationHint: hint } : undefined)
    if (isUpgrade(request)) {
      const offered = offeredAccess(request.headers.get('sec-websocket-protocol'))
      if (!offered || !wellFormedCode(offered.code)) return refuseDial(offered, offered ? 'access: code refused' : 'access: code required')
      const asked = sha256Hex(offered.code)
      let hash = door.hash
      if (hash === undefined || !sameDigest(asked, hash ?? '')) hash = await hashInForce(stub)
      if (!sameDigest(asked, hash ?? '')) return refuseDial(offered, hash ? 'access: code refused' : 'access: the meeting point is closed')
      return stub.fetch(request)
    }
    const answer = await stub.fetch(request)
    // A recycle answered here: this isolate's copy is stale from this moment.
    if (url.pathname === CODE_PATH && answer.ok) door = { hash: undefined, at: -Infinity, asking: null }
    return answer
  },
}
