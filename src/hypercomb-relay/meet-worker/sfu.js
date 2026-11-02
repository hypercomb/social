// sfu.js — THE MEETING'S VIDEO, THROUGH CLOUDFLARE'S SFU
// (documentation/meeting-lobby.md, "Video"). jwize, 2026-11-02: "lets go on sfu
// only", a 1,000 GB monthly ceiling "should be fine".
//
// Each person in a meeting keeps ONE peer connection, to Cloudflare's SFU: they
// publish their camera and microphone once and subscribe to everyone else's.
// Nobody connects to anybody else, so nobody learns another person's address;
// only Cloudflare does. This file is the meeting point's half: four narrow
// routes onto Cloudflare's Realtime SFU API, holding the app token the browser
// never sees, and the ledger that keeps the month inside its budget.
//
//   (under /.well-known/hc-meet/sfu/)
//   POST session                     → sessions/new
//   POST session/:id/tracks          → sessions/:id/tracks/new
//   PUT  session/:id/renegotiate     → sessions/:id/renegotiate
//   PUT  session/:id/tracks/close    → sessions/:id/tracks/close
//   POST session/:id/beat            → (here only) the session is still in use
//   GET  spend                       → (here only) the month's spend, and the meeting's
//                                      split by session (what each one was sent)
//
// NOT A PASS-THROUGH. Every body is size-capped and shape-checked before it is
// forwarded: only local and remote track requests, offers and answers, mids.
//
// THE BUDGET. Cloudflare bills what it sends OUT. This ledger estimates it from
// what each session subscribes to — remote video tracks × time × the Auto
// picture's rate — and refuses new sessions and new subscriptions once the
// month's estimate reaches the ceiling (SFU_MONTHLY_GB). A session that stops
// beating for 90 s has its subscriptions closed, so an estimate is never
// quietly outrun by a stream nobody is watching.

// Under /.well-known/hc-meet/: the one path family pluginthematrix-core forwards
// to the meeting point besides a dial and the relay's info (blossom-worker
// worker.js meetingPointFor), so no other worker changes.
export const SFU_PREFIX = '/.well-known/hc-meet/sfu/'
const API = 'https://rtc.live.cloudflare.com/v1/apps'

const SESSION_ID = /^[A-Za-z0-9_-]{8,160}$/
const MEETING = /^[0-9a-f]{64}$/
const TRACK_NAME = /^[A-Za-z0-9_.:-]{1,96}$/
const MID = /^[A-Za-z0-9_-]{1,32}$/
const BODY_MAX = 96 * 1024
const SDP_MAX = 64 * 1024
const TRACKS_MAX = 16

/** Seats a meeting draws: the leader and the ring of six. */
export const PUBLISHERS_PER_MEETING = 7
/** A session silent this long is done: its subscriptions are closed. */
export const SESSION_IDLE_MS = 90_000
/** New sessions one address may open in a window. */
const SESSIONS_PER_ADDRESS = 20
const ADDRESS_WINDOW_MS = 10 * 60_000

/** What one remote video subscription costs, out of Cloudflare: the Auto
 *  picture (~1.5 Mbps) and its sound (~50 kbps), in GB per millisecond. */
export const GB_PER_MS_PER_VIDEO = (1.55e6 / 8 / 1000) / 1e9

export const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7)

/** The route a request names, or null. */
export function sfuRoute(method, pathname) {
  if (!pathname.startsWith(SFU_PREFIX)) return null
  const parts = pathname.slice(SFU_PREFIX.length).split('/')
  if (parts[0] === 'spend' && parts.length === 1) return method === 'GET' ? { op: 'spend' } : null
  if (parts[0] !== 'session') return null
  if (parts.length === 1) return method === 'POST' ? { op: 'session' } : null
  const sessionId = parts[1]
  if (!SESSION_ID.test(sessionId)) return null
  const rest = parts.slice(2).join('/')
  if (rest === 'tracks' && method === 'POST') return { op: 'tracks', sessionId }
  if (rest === 'renegotiate' && method === 'PUT') return { op: 'renegotiate', sessionId }
  if (rest === 'tracks/close' && method === 'PUT') return { op: 'close', sessionId }
  if (rest === 'beat' && method === 'POST') return { op: 'beat', sessionId }
  return null
}

const isDescription = (d, type) =>
  !!d && typeof d === 'object' && d.type === type && typeof d.sdp === 'string' && d.sdp.length > 0 && d.sdp.length <= SDP_MAX

/** The body each route accepts, or the reason it is refused. Only what the
 *  route needs is kept: anything else is dropped before Cloudflare sees it. */
export function checkSfuBody(op, body) {
  if (op === 'session' || op === 'beat' || op === 'spend') return { ok: true, body: {} }
  if (!body || typeof body !== 'object') return { ok: false, reason: 'a JSON body is required' }
  if (op === 'renegotiate') {
    return isDescription(body.sessionDescription, 'answer')
      ? { ok: true, body: { sessionDescription: { type: 'answer', sdp: body.sessionDescription.sdp } } }
      : { ok: false, reason: 'renegotiate takes { sessionDescription: { type: "answer", sdp } }' }
  }
  const tracks = Array.isArray(body.tracks) ? body.tracks : null
  if (!tracks || tracks.length === 0 || tracks.length > TRACKS_MAX) return { ok: false, reason: `between 1 and ${TRACKS_MAX} tracks` }
  if (op === 'close') {
    if (!tracks.every((t) => t && MID.test(String(t.mid)))) return { ok: false, reason: 'close names tracks by mid' }
    const kept = { tracks: tracks.map((t) => ({ mid: String(t.mid) })), force: body.force === true }
    if (body.sessionDescription !== undefined) {
      if (!isDescription(body.sessionDescription, 'offer')) return { ok: false, reason: 'an offer, if any' }
      kept.sessionDescription = { type: 'offer', sdp: body.sessionDescription.sdp }
    }
    return { ok: true, body: kept }
  }
  // tracks
  const out = []
  for (const t of tracks) {
    if (!t || !TRACK_NAME.test(String(t.trackName))) return { ok: false, reason: 'every track has a trackName' }
    if (t.location === 'local') {
      if (!MID.test(String(t.mid))) return { ok: false, reason: 'a local track names its mid' }
      out.push({ location: 'local', mid: String(t.mid), trackName: String(t.trackName) })
    } else if (t.location === 'remote') {
      if (!SESSION_ID.test(String(t.sessionId))) return { ok: false, reason: 'a remote track names the session it comes from' }
      out.push({ location: 'remote', sessionId: String(t.sessionId), trackName: String(t.trackName) })
    } else return { ok: false, reason: 'a track is local or remote' }
  }
  const kept = { tracks: out }
  const hasLocal = out.some((t) => t.location === 'local')
  if (hasLocal && !isDescription(body.sessionDescription, 'offer')) return { ok: false, reason: 'local tracks come with an offer' }
  if (body.sessionDescription !== undefined) {
    if (!isDescription(body.sessionDescription, 'offer')) return { ok: false, reason: 'an offer, if any' }
    kept.sessionDescription = { type: 'offer', sdp: body.sessionDescription.sdp }
  }
  return { ok: true, body: kept }
}

const isVideoName = (name) => /-video$/.test(String(name))

/** GB to the thousandth: a megabyte. */
const round = (gb) => Math.round(gb * 1000) / 1000

const reply = (status, body, cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } })

/** The meeting point's SFU desk: routes, the sessions it opened, the month's
 *  ledger. Memory plus one stored record (the ledger), like the meeting. */
export class SfuDesk {
  #appId
  #token
  #capGb
  #fetch
  #now
  #cors
  #sessions = new Map()   // sessionId → { meeting, ip, beatAt, chargedAt, remote: Map<mid, isVideo> }
  #opened = new Map()     // ip → recent session-creation times
  #spend = new Map()      // meeting → Map<sessionId, GB sent to it>, kept after a session ends while the meeting lives
  usage                   // { month, gb }
  dirty = false

  // fetch is wrapped, never stored bare: the Workers runtime refuses the
  // global fetch called with any `this` but the global ("Illegal
  // invocation"), and this.#fetch(...) would call it with the desk as `this`.
  constructor({ appId, token, monthlyGb, fetchImpl = (url, init) => fetch(url, init), now = Date.now, usage, cors = {} }) {
    this.#appId = String(appId ?? '').trim()
    this.#token = String(token ?? '').trim()
    const cap = Number(monthlyGb)
    this.#capGb = Number.isFinite(cap) && cap > 0 ? cap : 500
    this.#fetch = fetchImpl
    this.#now = now
    this.#cors = cors
    const month = monthOf(now())
    this.usage = usage && usage.month === month && Number.isFinite(usage.gb) ? { month, gb: usage.gb } : { month, gb: 0 }
  }

  get configured() { return !!(this.#appId && this.#token) }
  get sessionCount() { return this.#sessions.size }

  #spent() {
    const month = monthOf(this.#now())
    if (this.usage.month !== month) { this.usage = { month, gb: 0 }; this.dirty = true }
    return this.usage.gb >= this.#capGb
  }

  async #cloudflare(method, path, body) {
    const res = await this.#fetch(`${API}/${this.#appId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    let data = {}
    try { data = await res.json() } catch {}
    return { status: res.status, ok: res.ok, data }
  }

  /** Answer one /sfu/ request. `meeting` is the X-Hc-Meeting header. */
  async handle(request, { ip = '', meeting = '' } = {}) {
    if (!this.configured) return reply(501, { error: 'video is not set up on this meeting point' }, this.#cors)
    const url = new URL(request.url)
    const route = sfuRoute(request.method, url.pathname)
    if (!route) return reply(404, { error: 'not an SFU route' }, this.#cors)
    const raw = await request.text()
    if (raw.length > BODY_MAX) return reply(413, { error: 'too large' }, this.#cors)
    let parsed = null
    if (raw) { try { parsed = JSON.parse(raw) } catch { return reply(400, { error: 'not JSON' }, this.#cors) } }
    const checked = checkSfuBody(route.op, parsed)
    if (!checked.ok) return reply(400, { error: checked.reason }, this.#cors)
    const now = this.#now()

    if (route.op === 'spend') {
      if (!MEETING.test(meeting)) return reply(400, { error: 'name the meeting (X-Hc-Meeting)' }, this.#cors)
      return reply(200, this.spendOf(meeting), this.#cors)
    }

    if (route.op === 'session') {
      if (!MEETING.test(meeting)) return reply(400, { error: 'name the meeting (X-Hc-Meeting)' }, this.#cors)
      if (this.#spent()) return reply(429, { error: 'this month\'s video is used up; the meeting goes on without it' }, this.#cors)
      const inMeeting = [...this.#sessions.values()].filter((s) => s.meeting === meeting).length
      if (inMeeting >= PUBLISHERS_PER_MEETING) return reply(429, { error: 'the meeting is full' }, this.#cors)
      const recent = (this.#opened.get(ip) ?? []).filter((at) => now - at < ADDRESS_WINDOW_MS)
      if (recent.length >= SESSIONS_PER_ADDRESS) return reply(429, { error: 'too many sessions from this address' }, this.#cors)
      const cf = await this.#cloudflare('POST', '/sessions/new', checked.body)
      if (cf.ok && SESSION_ID.test(String(cf.data?.sessionId))) {
        recent.push(now)
        this.#opened.set(ip, recent)
        this.#sessions.set(cf.data.sessionId, { meeting, ip, beatAt: now, chargedAt: now, remote: new Map() })
      }
      return reply(cf.status, cf.data, this.#cors)
    }

    const session = this.#sessions.get(route.sessionId)
    if (!session) return reply(404, { error: 'no such session here' }, this.#cors)
    session.beatAt = now
    if (route.op === 'beat') return reply(200, { ok: true }, this.#cors)

    if (route.op === 'tracks') {
      const remote = checked.body.tracks.filter((t) => t.location === 'remote')
      if (remote.length && this.#spent()) return reply(429, { error: 'this month\'s video is used up' }, this.#cors)
      // A remote track must come from a session of the same meeting.
      for (const t of remote) {
        const from = this.#sessions.get(t.sessionId)
        if (!from || from.meeting !== session.meeting) return reply(403, { error: 'a track from outside this meeting' }, this.#cors)
      }
      this.#charge(now)
      const cf = await this.#cloudflare('POST', `/sessions/${route.sessionId}/tracks/new`, checked.body)
      if (cf.ok && Array.isArray(cf.data?.tracks)) {
        const remoteNames = new Set(remote.map((t) => t.trackName))
        for (const t of cf.data.tracks) {
          if (t && MID.test(String(t.mid)) && remoteNames.has(t.trackName) && !t.error) session.remote.set(String(t.mid), isVideoName(t.trackName))
        }
      }
      return reply(cf.status, cf.data, this.#cors)
    }

    if (route.op === 'renegotiate') {
      const cf = await this.#cloudflare('PUT', `/sessions/${route.sessionId}/renegotiate`, checked.body)
      return reply(cf.status, cf.data, this.#cors)
    }

    // close
    this.#charge(now)
    const cf = await this.#cloudflare('PUT', `/sessions/${route.sessionId}/tracks/close`, checked.body)
    if (cf.ok) for (const t of checked.body.tracks) session.remote.delete(t.mid)
    return reply(cf.status, cf.data, this.#cors)
  }

  /** Add what every live session has been sent since it was last charged. */
  #charge(now) {
    this.#spent()
    for (const [id, s] of this.#sessions) {
      const videos = [...s.remote.values()].filter(Boolean).length
      const elapsed = Math.max(0, Math.min(now, s.beatAt + SESSION_IDLE_MS) - s.chargedAt)
      if (videos && elapsed) {
        const gb = videos * elapsed * GB_PER_MS_PER_VIDEO
        this.usage.gb += gb
        this.dirty = true
        let split = this.#spend.get(s.meeting)
        if (!split) this.#spend.set(s.meeting, split = new Map())
        split.set(id, (split.get(id) ?? 0) + gb)
      }
      s.chargedAt = Math.max(s.chargedAt, now)
    }
  }

  /** The month's spend as the meeting point counts it, and the share of this
   *  meeting that each of its sessions was sent. Estimates, in GB: what
   *  Cloudflare bills is what it sends out, and a session is sent what it
   *  subscribes to. The same answer to everyone in the meeting. */
  spendOf(meeting) {
    this.#charge(this.#now())
    const split = this.#spend.get(meeting)
    const sessions = {}
    let gb = 0
    if (split) for (const [id, used] of split) { sessions[id] = round(used); gb += used }
    return { month: this.usage.month, gb: round(this.usage.gb), capGb: this.#capGb, meeting: { gb: round(gb), sessions } }
  }

  /** Charge, then close what has gone quiet. Returns the closes it sent. */
  async sweep() {
    const now = this.#now()
    this.#charge(now)
    const closing = []
    for (const [id, s] of this.#sessions) {
      if (now - s.beatAt < SESSION_IDLE_MS) continue
      this.#sessions.delete(id)
      if (s.remote.size) {
        closing.push(this.#cloudflare('PUT', `/sessions/${id}/tracks/close`, { tracks: [...s.remote.keys()].map((mid) => ({ mid })), force: true }).catch(() => null))
      }
    }
    for (const [ip, times] of this.#opened) {
      const recent = times.filter((at) => now - at < ADDRESS_WINDOW_MS)
      if (recent.length) this.#opened.set(ip, recent)
      else this.#opened.delete(ip)
    }
    // A meeting nobody is in any more takes its split with it.
    const live = new Set([...this.#sessions.values()].map((s) => s.meeting))
    for (const meeting of this.#spend.keys()) if (!live.has(meeting)) this.#spend.delete(meeting)
    await Promise.all(closing)
    return closing.length
  }
}
