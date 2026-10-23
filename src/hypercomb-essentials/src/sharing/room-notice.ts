// sharing/room-notice.ts
//
// THE SESSION START NOTICE (documentation/swarm-notes.md, "Starting a
// session"). The host says `room start`; everyone who has been in that room
// before gets a notice with a Join button — even when they are not in a room
// right now. This is its pure half: the rooms this device remembers, the
// notice's address, and how a notice is read. No store, no network.
//
//   remembered  the rooms this device joined, newest first. Each holds the
//               room's SECRET, so the list is a credential: it lives in this
//               device's localStorage only, never a pool, a resource, an
//               event or an export (feedback: secrets never in pools). The
//               one write is the join's (meeting-invite.join.ts).
//   address     sign('room:notice:' + the room's pool address). The pool
//               address holds the secret, so only someone given the room can
//               ask for — or post — its notice.
//   notice      a nostr event, kind ROOM_NOTICE_KIND, addressable (one per
//               signer per room: d = the address), tagged x = the address,
//               content { label, segments, startedAt }. Never the secret. It
//               is fresh for NOTICE_FRESH_SEC from startedAt; after that a
//               session is not "starting".
//   re-posted   the meeting point keeps events in memory only, so a restart
//               of it would lose the notice for anyone who opens their hive
//               later. While the host stays in the room its hive posts the
//               notice again every NOTICE_REPOST_MS — same startedAt, same
//               expiration — and a listener knows a re-post by its start
//               (noticeKey), so nobody is told twice.

import { SignatureService } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'
import { roomPoolAddress } from './room-pool.js'

export const ROOM_NOTICE_KIND = 30569
export const REMEMBERED_ROOMS_KEY = 'hc:rooms'
/** How long a start notice stays news — and how long the relay keeps it. */
export const NOTICE_FRESH_SEC = 3 * 60 * 60
/** While the host stays in the room, the notice is posted again this often. */
export const NOTICE_REPOST_MS = 5 * 60 * 1000
/** A device remembers this many rooms; the oldest falls off. */
export const REMEMBERED_ROOMS_MAX = 12

const SIG = /^[0-9a-f]{64}$/
const LABEL_MAX = 120
const utf8 = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

/** A room this device has been in: enough to hear its notice and rejoin. */
export interface RememberedRoom {
  readonly room: string
  readonly secret: string
  /** The meeting point, `ws(s)://…` — where its notice is posted. */
  readonly relay: string
  readonly host?: string
  readonly code?: string
  readonly segments: readonly string[]
  readonly label: string
  /** Epoch ms of the last join. */
  readonly at: number
}

const str = (v: unknown): string => typeof v === 'string' ? v.trim() : ''

const cleanRoom = (raw: unknown): RememberedRoom | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const room = str(o['room']), secret = str(o['secret']), relay = str(o['relay'])
  if (!room || !secret || !/^wss?:\/\//.test(relay)) return null
  const segments = Array.isArray(o['segments']) ? o['segments'].map(str).filter(Boolean) : []
  const host = str(o['host']), code = str(o['code'])
  return {
    room, secret, relay,
    ...(host ? { host } : {}),
    ...(code ? { code } : {}),
    segments,
    label: str(o['label']).slice(0, LABEL_MAX) || room,
    at: Number(o['at']) || 0,
  }
}

const sameRoom = (a: RememberedRoom, b: RememberedRoom): boolean =>
  a.room === b.room && a.secret === b.secret && a.relay === b.relay

/** The remembered list out of its stored text; anything malformed is dropped. */
export function parseRememberedRooms(text: string | null | undefined): RememberedRoom[] {
  let parsed: unknown
  try { parsed = JSON.parse(String(text ?? '')) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const out: RememberedRoom[] = []
  for (const raw of parsed) {
    const r = cleanRoom(raw)
    if (r && !out.some(o => sameRoom(o, r))) out.push(r)
  }
  return out.slice(0, REMEMBERED_ROOMS_MAX)
}

/** This device's remembered rooms. Never throws. */
export function readRememberedRooms(): RememberedRoom[] {
  try { return parseRememberedRooms(localStorage.getItem(REMEMBERED_ROOMS_KEY)) } catch { return [] }
}

/** The list with `entry` at the front (a room joined again moves up). */
export function withRoom(list: readonly RememberedRoom[], entry: RememberedRoom): RememberedRoom[] {
  const clean = cleanRoom(entry)
  if (!clean) return [...list]
  return [clean, ...list.filter(r => !sameRoom(r, clean))].slice(0, REMEMBERED_ROOMS_MAX)
}

/** The notice address of a room at its meeting point, or '' (no host). */
export async function noticeAddress(room: string, secret: string, relay: string): Promise<string> {
  const pool = await roomPoolAddress(room, secret, relay)
  return pool ? SignatureService.sign(utf8('room:notice:' + pool)) : ''
}

/** What a start notice carries. */
export interface RoomNotice {
  readonly id: string
  readonly signer: string
  readonly label: string
  readonly segments: readonly string[]
  /** When it was posted (created_at). */
  readonly at: number
  /** When the session started: the first post's time, kept by every re-post. */
  readonly started: number
}

/** One session's notice, however often it is posted. */
export const noticeKey = (n: Pick<RoomNotice, 'signer' | 'started'>): string => `${n.signer}:${n.started}`

type NoticeEvent = { id?: unknown; kind?: unknown; pubkey?: unknown; created_at?: unknown; tags?: unknown; content?: unknown; sig?: unknown }

const tagOf = (evt: NoticeEvent, name: string): string => {
  const tags = Array.isArray(evt.tags) ? evt.tags : []
  const hit = tags.find((t): t is unknown[] => Array.isArray(t) && t[0] === name)
  return String(hit?.[1] ?? '').toLowerCase()
}

/** A notice as read, or null: the right kind, at THIS address, fresh, signed.
 *  `verify` is injectable for the spec. */
export function readNotice(
  raw: unknown,
  address: string,
  nowSec = Math.floor(Date.now() / 1000),
  verify: (evt: unknown) => boolean = (evt) => verifyEvent(evt as Parameters<typeof verifyEvent>[0]),
): RoomNotice | null {
  if (!raw || typeof raw !== 'object' || !SIG.test(address)) return null
  const evt = raw as NoticeEvent
  if (Number(evt.kind) !== ROOM_NOTICE_KIND || tagOf(evt, 'x') !== address) return null
  const at = Number(evt.created_at) || 0
  if (at > nowSec + 300) return null
  let content: Record<string, unknown> = {}
  try { const c = JSON.parse(String(evt.content ?? '{}')); if (c && typeof c === 'object' && !Array.isArray(c)) content = c } catch { /* a bare notice */ }
  // A notice from before re-posting carries no start: its post is its start.
  // A start is never later than the post that carries it.
  const said = Number(content['startedAt'])
  const started = Number.isInteger(said) && said > 0 ? Math.min(said, at) : at
  if (nowSec - started > NOTICE_FRESH_SEC) return null
  try { if (!verify(evt)) return null } catch { return null }
  const segments = Array.isArray(content['segments']) ? content['segments'].map(str).filter(Boolean) : []
  return {
    id: String(evt.id ?? ''),
    signer: String(evt.pubkey ?? '').toLowerCase(),
    label: str(content['label']).slice(0, LABEL_MAX),
    segments,
    at,
    started,
  }
}

/** The notice's content and tags, as `room start` posts it — and as every
 *  re-post does: the same start, so the same expiration. */
export function noticeTemplate(address: string, label: string, segments: readonly string[], startedSec = Math.floor(Date.now() / 1000)) {
  return {
    content: { label: String(label ?? '').trim().slice(0, LABEL_MAX), segments: [...segments], startedAt: startedSec },
    tags: [['d', address], ['expiration', String(startedSec + NOTICE_FRESH_SEC)]],
  }
}
