// sharing/room-notice.drone.ts
//
// HEARING A SESSION START (room-notice.ts). For every room this device
// remembers, one small socket to that room's meeting point asks for its
// start notice — joined or not, wherever this hive is. A fresh notice from
// someone else, for a room this tab is not in right now, is a toast that
// stays until answered: "The session in <room> is starting — Join". Join
// goes through the one join path (joinMeetingPlace), which asks as a link
// would. Nothing joins by itself.
//
// The sockets are the drone's own, not the mesh's: the mesh dials ONE
// meeting point per tab, and a remembered room may meet anywhere. Each asks
// one filter (`kinds` + `#x`), so a meeting point answers it like any REQ.
// A meeting point closes a socket it has heard nothing from for two minutes,
// so each one renews its listen every RENEW_MS — live only (`limit: 0`) once
// the stored notices have come (EOSE); a refused listen (CLOSED) redials.
//
// THE HOST'S SIDE (`room start`, room.queen.ts) lives here too: announce()
// signs the notice ONCE and posts it, then posts that same signed event again
// every NOTICE_REPOST_MS while this tab stays in that room, for as long as the
// notice is fresh — the meeting point keeps it in memory only. The same event
// is the same id, so no listener, of this version or an older one that knew a
// notice by its id, takes a re-post for a new start. It goes out on the mesh's
// own socket to the meeting point (sendSigned), a socket of its own only when
// the mesh meets elsewhere. A reload resumes it: the signed event (never the
// secret) is kept in this tab's sessionStorage.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere, ownZone, readTabZone } from './membership.js'
import { joinMeetingPlace } from './meeting-invite.join.js'
import { MEETING_INVITE_KIND, MEETING_INVITE_VERSION } from './meeting-invite.js'
import { NOTICE_FRESH_SEC, NOTICE_REPOST_MS, REMEMBERED_ROOMS_KEY, ROOM_NOTICE_KIND, noticeAddress, noticeKey, noticeTemplate, readNotice, readRememberedRooms, type RememberedRoom } from './room-notice.js'

export const ROOM_NOTICE_JOIN_EFFECT = 'room-notice:join'

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const ACCESS_PROTOCOL_PREFIX = 'hc-access.'
const ACCESS_CODE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,256}$/
/** How long the drone waits after boot before it dials anything. */
const BOOT_DELAY_MS = 4_000
const RETRY_MS = [5_000, 30_000, 120_000, 300_000]
/** Well under the meeting point's two-minute reap of a silent socket — and
 *  still under it in a hidden tab, whose timers wake only on whole minutes. */
const RENEW_MS = 45_000
/** How long a post waits for the meeting point to take it. */
const TAKEN_MS = 15_000
/** Sessions already shown in this tab (address + noticeKey, and the event id
 *  an older version kept) — a new tab shows a fresh one again, a re-post never
 *  does. */
const SEEN_KEY = 'hc:room-notice-seen'
/** The session this tab is announcing, so a reload resumes it. */
const ANNOUNCING_KEY = 'hc:room-notice-announcing'

type NoticeEvent = { id?: string; pubkey?: string; sig?: string; kind: number; created_at: number; tags: string[][]; content: string }
type SignerShape = {
  getPublicKeyHex?: () => Promise<string | null>
  signEvent?: (evt: NoticeEvent) => Promise<NoticeEvent>
}
/** The mesh's clock is the meeting point's: a notice stamped by it is never
 *  refused for a device clock that runs fast. */
type MeshShape = {
  meetingRelay?: () => string
  nowSec?: () => number
  sendSigned?: (evt: NoticeEvent, onTaken?: () => void) => boolean
  getDebug?: () => { relays?: readonly string[] } | undefined
}

/** Is this tab still in the room a notice names? 'unknown' while the mesh has
 *  not come up yet (a reload) — never taken for "left". */
type Here = 'yes' | 'no' | 'unknown'

/** A refusal that will not change by asking again (meeting.js reasons). */
const STANDING_REFUSAL = /^(restricted|invalid|auth-required):/

/** The session this tab started: what a reload needs to resume it. */
interface AnnounceRecord { address: string; relay: string; signed: NoticeEvent; startedSec: number }
interface Announcing extends AnnounceRecord { timer: ReturnType<typeof setInterval> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

const bareRelay = (url: string): string => url.trim().replace(/\/+$/, '')

interface Listen {
  room: RememberedRoom
  address: string
  ws: WebSocket | null
  tries: number
  timer: ReturnType<typeof setTimeout> | null
  renew: ReturnType<typeof setInterval> | null
  /** The stored notices have come: renewals ask live only. */
  eosed: boolean
  /** Refused for good: no retry until the remembered rooms change. */
  parked: boolean
  closed: boolean
}

export class RoomNoticeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Tells you when a room you have been in starts a session, with a Join button'

  protected override listens = ['mesh:public-changed', ROOM_NOTICE_JOIN_EFFECT]
  protected override emits = ['toast:show']

  /** Address → its socket. */
  #listens = new Map<string, Listen>()
  #seen = new Set<string>()
  #me = ''
  #announcing: Announcing | null = null
  /** Each `room start` takes a number; a later one supersedes an earlier one
   *  still signing. */
  #gen = 0
  /** The newest start shown per address + signer: an older session's re-post
   *  (a second host tab, after a restart) is never news. */
  #newest = new Map<string, number>()
  /** Resuming waits for boot: before it the mesh may not exist yet. */
  #booted = false

  constructor() {
    super()
    try { for (const id of JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]) this.#remember(id) } catch { /* none yet */ }
    setTimeout(() => { this.#booted = true; void this.#sync(); void this.#resume() }, BOOT_DELAY_MS)
    // A join adds a room; another tab's join reaches this one by `storage`.
    EffectBus.on('mesh:public-changed', () => { void this.#sync(); if (this.#booted) void this.#resume() })
    window.addEventListener('storage', (e) => { if (e.key === REMEMBERED_ROOMS_KEY) void this.#sync() })
    EffectBus.on<{ address?: unknown }>(ROOM_NOTICE_JOIN_EFFECT, (p) => { void this.#join(String(p?.address ?? '')) })
  }

  /** What this drone hears, for the harness. */
  listening = (): string[] => [...this.#listens.values()].map(l => l.room.label)

  /** The session this tab is announcing, for the harness. */
  announcing = (): { address: string; startedSec: number } | null =>
    this.#announcing ? { address: this.#announcing.address, startedSec: this.#announcing.startedSec } : null

  // ── the host's side ─────────────────────────────────────────

  /** `room start`: post this room's notice, and keep posting it while this tab
   *  stays in the room. True when the meeting point took the first post. A
   *  start that is not signed leaves a running session's posts as they were. */
  announce = async (room: string, secret: string, relay: string, label: string, segments: readonly string[]): Promise<boolean> => {
    const gen = ++this.#gen
    const address = await noticeAddress(room, secret, relay).catch(() => '')
    if (!address || gen !== this.#gen) return false
    const startedSec = this.#nowSec()
    const { content, tags } = noticeTemplate(address, label, segments, startedSec)
    let signed: NoticeEvent | undefined
    try {
      signed = await get<SignerShape>(SIGNER_KEY)?.signEvent?.({
        kind: ROOM_NOTICE_KIND, created_at: startedSec, tags: [['x', address], ...tags], content: JSON.stringify(content),
      })
    } catch { signed = undefined }
    if (gen !== this.#gen || !signed?.id || !signed.sig) return false
    const a = this.#arm({ address, relay, signed, startedSec })
    return this.#post(a)
  }

  #arm(record: AnnounceRecord): Announcing {
    this.#stopAnnouncing()
    const timer = setInterval(() => void this.#repost(), NOTICE_REPOST_MS)
    this.#announcing = { ...record, timer }
    try { sessionStorage.setItem(ANNOUNCING_KEY, JSON.stringify(record)) } catch { /* this page only */ }
    return this.#announcing
  }

  /** After a reload: the session this tab was announcing, while it still is in
   *  that room and the notice is still news. */
  async #resume(): Promise<void> {
    if (this.#announcing) return
    let record: AnnounceRecord | null = null
    try { record = JSON.parse(sessionStorage.getItem(ANNOUNCING_KEY) ?? 'null') as AnnounceRecord | null } catch { record = null }
    if (!record?.signed?.id || !record.signed.sig || !record.address) return
    const gen = this.#gen
    const stale = this.#nowSec() - record.startedSec >= NOTICE_FRESH_SEC
    const here = stale ? 'no' : await this.#stillHere(record)
    if (gen !== this.#gen || this.#announcing || here === 'unknown') return
    if (here === 'no') { try { sessionStorage.removeItem(ANNOUNCING_KEY) } catch { /* gone */ } return }
    void this.#post(this.#arm(record))
  }

  async #repost(): Promise<void> {
    const a = this.#announcing
    if (!a) return
    // Over when the notice is no longer news, or this tab left the room; a
    // tick that cannot tell yet waits for the next.
    const stale = this.#nowSec() - a.startedSec >= NOTICE_FRESH_SEC
    const here = stale ? 'no' : await this.#stillHere(a)
    if (this.#announcing !== a || here === 'unknown') return
    if (here === 'no') { this.#stopAnnouncing(); return }
    await this.#post(a)
  }

  /** This tab is still joined in the room the notice names, at its point. */
  async #stillHere(a: AnnounceRecord): Promise<Here> {
    const zone = ownZone()
    if (!zone || !isJoinedHere()) return 'no'
    const mesh = get<MeshShape>(MESH_KEY)
    const relay = String(mesh?.meetingRelay?.() ?? '')
    if (!mesh?.meetingRelay || !relay) return 'unknown'
    if (bareRelay(relay) !== bareRelay(a.relay)) return 'no'
    return (await noticeAddress(zone.room, zone.secret, relay).catch(() => '')) === a.address ? 'yes' : 'no'
  }

  /** One post: the session's one signed event, as it is. On the mesh's own
   *  socket when the mesh meets at this point; else a socket of its own (with
   *  this tab's access code when the point is the one this tab meets at). */
  #post(a: AnnounceRecord): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let done = false
      let ws: WebSocket | null = null
      const finish = (ok: boolean): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        try { ws?.close() } catch { /* gone */ }
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), TAKEN_MS)
      // The mesh's socket only when it dials this point and no other: it
      // sends to every relay it dials, and any one's OK would read as taken.
      const mesh = get<MeshShape>(MESH_KEY)
      let dials: readonly string[] = []
      try { dials = mesh?.getDebug?.()?.relays ?? [] } catch { dials = [] }
      if (mesh?.sendSigned && dials.length === 1 && bareRelay(dials[0]) === bareRelay(a.relay)) {
        if (mesh.sendSigned(a.signed, () => finish(true))) return
      }
      const zone = readTabZone()
      const code = zone?.code && bareRelay(zone.relay ?? '') === bareRelay(a.relay) && ACCESS_CODE_RE.test(zone.code) ? zone.code : ''
      try { ws = code ? new WebSocket(a.relay, [ACCESS_PROTOCOL_PREFIX + code]) : new WebSocket(a.relay) } catch { finish(false); return }
      ws.onopen = () => ws?.send(JSON.stringify(['EVENT', a.signed]))
      ws.onmessage = (e) => {
        let msg: unknown
        try { msg = JSON.parse(String(e.data)) } catch { return }
        // A point that already holds it says so (`duplicate:`) — taken.
        if (Array.isArray(msg) && msg[0] === 'OK' && msg[1] === a.signed.id) finish(msg[2] === true || /^duplicate/.test(String(msg[3] ?? '')))
      }
      ws.onerror = () => finish(false)
      ws.onclose = () => finish(false)
    })
  }

  #stopAnnouncing(): void {
    if (this.#announcing) clearInterval(this.#announcing.timer)
    this.#announcing = null
    try { sessionStorage.removeItem(ANNOUNCING_KEY) } catch { /* gone */ }
  }

  #nowSec(): number {
    return get<MeshShape>(MESH_KEY)?.nowSec?.() ?? Math.floor(Date.now() / 1000)
  }

  // ── the listener's side ─────────────────────────────────────

  async #sync(): Promise<void> {
    if (!this.#me) {
      try { this.#me = String(await get<SignerShape>(SIGNER_KEY)?.getPublicKeyHex?.() ?? '').toLowerCase() } catch { /* unsigned */ }
    }
    const want = new Map<string, RememberedRoom>()
    for (const room of readRememberedRooms()) {
      const address = await noticeAddress(room.room, room.secret, room.relay).catch(() => '')
      if (address) want.set(address, room)
    }
    for (const [address, l] of this.#listens) {
      if (!want.has(address)) { l.closed = true; if (l.timer) clearTimeout(l.timer); if (l.renew) clearInterval(l.renew); try { l.ws?.close() } catch { /* gone */ }; this.#listens.delete(address) }
    }
    for (const [address, room] of want) {
      const held = this.#listens.get(address)
      if (held) {
        held.room = room
        if (held.parked && !held.ws && !held.timer) { held.parked = false; held.tries = 0; this.#dial(held) }
        continue
      }
      const l: Listen = { room, address, ws: null, tries: 0, timer: null, renew: null, eosed: false, parked: false, closed: false }
      this.#listens.set(address, l)
      this.#dial(l)
    }
  }

  #dial(l: Listen): void {
    if (l.closed) return
    const code = l.room.code && ACCESS_CODE_RE.test(l.room.code) ? l.room.code : ''
    let ws: WebSocket
    try { ws = code ? new WebSocket(l.room.relay, [ACCESS_PROTOCOL_PREFIX + code]) : new WebSocket(l.room.relay) } catch { this.#retry(l); return }
    l.ws = ws
    l.eosed = false
    const sub = 'notice-' + l.address.slice(0, 12)
    const filter = { kinds: [ROOM_NOTICE_KIND], '#x': [l.address] }
    const ask = (): void => {
      const since = Math.floor(Date.now() / 1000) - NOTICE_FRESH_SEC
      // The same subscription each time. Once the stored notices have come it
      // is live only: nothing is sent again, and the point hears this socket.
      ws.send(JSON.stringify(['REQ', sub, l.eosed ? { ...filter, limit: 0 } : { ...filter, since }]))
    }
    ws.onopen = () => {
      ask()
      if (l.renew) clearInterval(l.renew)
      l.renew = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ask() }, RENEW_MS)
    }
    ws.onmessage = (e) => {
      let msg: unknown
      try { msg = JSON.parse(String(e.data)) } catch { return }
      if (!Array.isArray(msg) || msg[1] !== sub) return
      if (msg[0] === 'EVENT') this.#heard(l, msg[2])
      else if (msg[0] === 'EOSE') { l.eosed = true; l.tries = 0 }
      // Refused. Full or rate-limited: try again later, asking for the stored
      // notices again. Refused for good: wait until the rooms change.
      else if (msg[0] === 'CLOSED') {
        if (STANDING_REFUSAL.test(String(msg[2] ?? ''))) l.parked = true
        try { ws.close() } catch { /* gone */ }
      }
    }
    ws.onclose = () => {
      if (l.ws !== ws) return
      l.ws = null
      if (l.renew) { clearInterval(l.renew); l.renew = null }
      this.#retry(l)
    }
  }

  #retry(l: Listen): void {
    if (l.closed || l.parked) return
    const wait = RETRY_MS[Math.min(l.tries, RETRY_MS.length - 1)]
    l.tries++
    l.timer = setTimeout(() => { l.timer = null; this.#dial(l) }, wait)
  }

  #heard(l: Listen, raw: unknown): void {
    const notice = readNotice(raw, l.address)
    if (!notice) return
    const key = `${l.address}:${noticeKey(notice)}`
    if (this.#seen.has(key) || (notice.id && this.#seen.has(notice.id))) return
    const newest = this.#newest.get(`${l.address}:${notice.signer}`)
    if (newest !== undefined && notice.started <= newest) return
    // Your own start, or a room this tab is already in: nothing to say.
    if (notice.signer && notice.signer === this.#me) return
    const zone = ownZone()
    if (zone && isJoinedHere() && zone.room === l.room.room && zone.secret === l.room.secret) return
    this.#remember(key)
    if (notice.id) this.#remember(notice.id)
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...this.#seen].slice(-100))) } catch { /* this tab only */ }
    const label = notice.label || l.room.label
    EffectBus.emit('toast:show', {
      type: 'info',
      title: this.#t('room.notice.title', 'A session is starting'),
      message: this.#t('room.notice.message', `The session in "${label}" is starting.`, { label }),
      duration: 0,
      actionLabel: this.#t('room.notice.join', 'Join'),
      actionEffect: ROOM_NOTICE_JOIN_EFFECT,
      // The address names the room; the secret never rides the bus.
      actionPayload: { address: l.address },
    })
  }

  /** A seen entry: an event id, or `address:signer:started` — which also
   *  raises that signer's newest start at that address. */
  #remember(entry: string): void {
    this.#seen.add(entry)
    const [address, signer, started] = entry.split(':')
    const at = Number(started)
    if (!address || !signer || !Number.isInteger(at)) return
    const key = `${address}:${signer}`
    if ((this.#newest.get(key) ?? -1) < at) this.#newest.set(key, at)
  }

  async #join(address: string): Promise<void> {
    const l = this.#listens.get(address)
    if (!l) return
    const r = l.room
    await joinMeetingPlace({
      kind: MEETING_INVITE_KIND, v: MEETING_INVITE_VERSION,
      segments: [...r.segments], room: r.room, secret: r.secret, alias: r.label,
      relay: r.relay, ...(r.host ? { host: r.host } : {}), ...(r.code ? { code: r.code } : {}),
    }, r.secret).catch(() => false)
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const v = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
    return v && v !== key ? v : fallback
  }
}

const _roomNotice = new RoomNoticeDrone()
window.ioc.register('@diamondcoreprocessor.com/RoomNoticeDrone', _roomNotice)
