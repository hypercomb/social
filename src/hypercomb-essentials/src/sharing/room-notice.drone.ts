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

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere, ownZone } from './membership.js'
import { joinMeetingPlace } from './meeting-invite.join.js'
import { MEETING_INVITE_KIND, MEETING_INVITE_VERSION } from './meeting-invite.js'
import { NOTICE_FRESH_SEC, REMEMBERED_ROOMS_KEY, ROOM_NOTICE_KIND, noticeAddress, readNotice, readRememberedRooms, type RememberedRoom } from './room-notice.js'

export const ROOM_NOTICE_JOIN_EFFECT = 'room-notice:join'

const ACCESS_PROTOCOL_PREFIX = 'hc-access.'
const ACCESS_CODE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,256}$/
/** How long the drone waits after boot before it dials anything. */
const BOOT_DELAY_MS = 4_000
const RETRY_MS = [5_000, 30_000, 120_000, 300_000]
/** Notices already shown in this tab (ids) — a reload shows a fresh one again
 *  only until it is answered here. */
const SEEN_KEY = 'hc:room-notice-seen'

type SignerShape = { getPublicKeyHex?: () => Promise<string | null> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

interface Listen { room: RememberedRoom; address: string; ws: WebSocket | null; tries: number; timer: ReturnType<typeof setTimeout> | null; closed: boolean }

export class RoomNoticeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Tells you when a room you have been in starts a session, with a Join button'

  protected override listens = ['mesh:public-changed', ROOM_NOTICE_JOIN_EFFECT]
  protected override emits = ['toast:show']

  /** Address → its socket. */
  #listens = new Map<string, Listen>()
  #seen = new Set<string>()
  #me = ''

  constructor() {
    super()
    try { for (const id of JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]) this.#seen.add(id) } catch { /* none yet */ }
    setTimeout(() => void this.#sync(), BOOT_DELAY_MS)
    // A join adds a room; another tab's join reaches this one by `storage`.
    EffectBus.on('mesh:public-changed', () => { void this.#sync() })
    window.addEventListener('storage', (e) => { if (e.key === REMEMBERED_ROOMS_KEY) void this.#sync() })
    EffectBus.on<{ address?: unknown }>(ROOM_NOTICE_JOIN_EFFECT, (p) => { void this.#join(String(p?.address ?? '')) })
  }

  /** What this drone hears, for the harness. */
  listening = (): string[] => [...this.#listens.values()].map(l => l.room.label)

  async #sync(): Promise<void> {
    if (!this.#me) {
      try { this.#me = String(await get<SignerShape>('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.() ?? '').toLowerCase() } catch { /* unsigned */ }
    }
    const want = new Map<string, RememberedRoom>()
    for (const room of readRememberedRooms()) {
      const address = await noticeAddress(room.room, room.secret, room.relay).catch(() => '')
      if (address) want.set(address, room)
    }
    for (const [address, l] of this.#listens) {
      if (!want.has(address)) { l.closed = true; if (l.timer) clearTimeout(l.timer); try { l.ws?.close() } catch { /* gone */ }; this.#listens.delete(address) }
    }
    for (const [address, room] of want) {
      const held = this.#listens.get(address)
      if (held) { held.room = room; continue }
      const l: Listen = { room, address, ws: null, tries: 0, timer: null, closed: false }
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
    const sub = 'notice-' + l.address.slice(0, 12)
    ws.onopen = () => {
      l.tries = 0
      const since = Math.floor(Date.now() / 1000) - NOTICE_FRESH_SEC
      ws.send(JSON.stringify(['REQ', sub, { kinds: [ROOM_NOTICE_KIND], '#x': [l.address], since }]))
    }
    ws.onmessage = (e) => {
      let msg: unknown
      try { msg = JSON.parse(String(e.data)) } catch { return }
      if (Array.isArray(msg) && msg[0] === 'EVENT' && msg[1] === sub) this.#heard(l, msg[2])
    }
    ws.onclose = () => { if (l.ws === ws) { l.ws = null; this.#retry(l) } }
  }

  #retry(l: Listen): void {
    if (l.closed) return
    const wait = RETRY_MS[Math.min(l.tries, RETRY_MS.length - 1)]
    l.tries++
    l.timer = setTimeout(() => { l.timer = null; this.#dial(l) }, wait)
  }

  #heard(l: Listen, raw: unknown): void {
    const notice = readNotice(raw, l.address)
    if (!notice || this.#seen.has(notice.id)) return
    // Your own start, or a room this tab is already in: nothing to say.
    if (notice.signer && notice.signer === this.#me) return
    const zone = ownZone()
    if (zone && isJoinedHere() && zone.room === l.room.room && zone.secret === l.room.secret) return
    this.#seen.add(notice.id)
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...this.#seen].slice(-50))) } catch { /* this tab only */ }
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
