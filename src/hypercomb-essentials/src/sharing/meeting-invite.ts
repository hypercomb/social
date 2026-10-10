// sharing/meeting-invite.ts
//
// The signature-addressed "meeting place" invite bundle.
//
// A swarm channel is the tuple (segments, room, secret): SwarmDrone hashes
// `segments.join('/') \0 room \0 secret` to address the relay slot (see
// composeSigForSegments). To hand someone the SAME meeting place we package
// exactly those three inputs — plus an optional display alias — into a
// content-addressed JSON resource. Sharing the resource's signature as
// `https://<host>/<sig>` lets a recipient reproduce the identical channel:
// same inputs → same sha256 → same slot.
//
// The bundle is a RESOURCE (content-addressed via Store.putResource), so the
// signature in the link is a BEARER TOKEN — anyone who holds it can fetch the
// bundle from the host and join. That is the intended "anyone-with-the-link"
// model: the link itself reveals nothing (it is an opaque hash), and
// possession of it is the invitation.
//
// A bare `invite` (no tile selected) no longer mints a bundle at all: it
// hands out the MEETING LINK below, which carries the same three inputs in
// its fragment and needs no host. The bundle stays the shape of a tile-borne
// junction, whose signature rides the wire.
//
// This module holds ONLY pure data + validation so both the receive-side
// worker and the /invite share queen can import it without pulling in any
// runtime. It imports nothing.

export const MEETING_INVITE_KIND = 'hypercomb.meeting-invite'
export const MEETING_INVITE_VERSION = 1

/** sessionStorage key the web/dev shell stashes a pending invite signature
 *  under when the boot URL is `/<sig>`. The receive-side worker drains it.
 *
 *  The capture lives in the shell (hypercomb-shared/core/invite-capture.ts)
 *  and MUST NOT import essentials, so this literal is mirrored there with a
 *  comment pointing back here. Keep the two in sync. */
export const PENDING_INVITE_KEY = 'hc:pending-invite'

export interface MeetingInviteBundle {
  kind: typeof MEETING_INVITE_KIND
  /** Schema version — informational; older readers tolerate unknown extras. */
  v: number
  /** Hive path the meeting place lives at: the nav segments that fold into
   *  the channel sig. Empty array = hive root. */
  segments: string[]
  /** Room id (RoomStore). Folds into the channel sig. Required, non-empty. */
  room: string
  /** Access secret (SecretStore). Folds into the channel sig. ONLY on a
   *  bundle that never leaves the device (a `#meet=` link parsed in memory)
   *  or one minted before 2026-10-07 — read, never written. A secret is
   *  never stored where it can be fetched (jwize, 2026-10-07: "the key can
   *  never be stored in a pool or public place"). */
  secret?: string
  /** What a stored bundle carries instead: `inviteSecretCheck(room, secret)`.
   *  It names the secret without holding it — a swarm peer, who already holds
   *  this room's secret, matches it and joins; a link carries the secret in
   *  its fragment, which no server sees. */
  secretCheck?: string
  /** Optional display label, shown in the recipient's join prompt. */
  alias?: string
  /** Epoch ms the invite was minted (informational only). */
  createdAt?: number
}

// Segments are single path components — reject anything carrying a slash so a
// malformed bundle can't smuggle extra path depth into navigation.
const SLASH_RE = /[\/\\]/

/** Structural validation — answers "is this meta file a valid credential
 *  file?". Returns a normalized bundle or null. Never throws. */
export function validateInviteBundle(raw: unknown): MeetingInviteBundle | null {
  if (!raw || typeof raw !== 'object') return null
  // Bracket access throughout — the web/dev Angular build runs
  // noPropertyAccessFromIndexSignature, which forbids dot access on a Record.
  const o = raw as Record<string, unknown>
  if (o['kind'] !== MEETING_INVITE_KIND) return null
  const room = o['room']
  const secretRaw = o['secret']
  const checkRaw = o['secretCheck']
  if (typeof room !== 'string' || !room.trim()) return null
  const secret = typeof secretRaw === 'string' && secretRaw.trim() ? secretRaw.trim() : ''
  const secretCheck = typeof checkRaw === 'string' && /^[0-9a-f]{64}$/.test(checkRaw) ? checkRaw : ''
  if (!secret && !secretCheck) return null

  const rawSegments = o['segments']
  const segments = Array.isArray(rawSegments)
    ? rawSegments
        .map(s => String(s ?? '').trim())
        .filter(s => s.length > 0 && !SLASH_RE.test(s))
    : []

  const vRaw = o['v']
  const v = typeof vRaw === 'number' ? vRaw : MEETING_INVITE_VERSION
  const aliasRaw = o['alias']
  const alias = typeof aliasRaw === 'string' ? aliasRaw.trim().slice(0, 120) : ''
  const createdAtRaw = o['createdAt']
  const createdAt = typeof createdAtRaw === 'number' ? createdAtRaw : undefined

  return {
    kind: MEETING_INVITE_KIND,
    v,
    segments,
    room: room.trim(),
    ...(secret ? { secret } : {}),
    ...(secretCheck ? { secretCheck } : {}),
    ...(alias ? { alias } : {}),
    ...(createdAt ? { createdAt } : {}),
  }
}

// ── The meeting link ──────────────────────────────────────────────────
//
// `https://<origin>/#meet=<room>/<secret>[/<segment>...][&relay=…][&host=…][&code=…]`,
// each part percent-encoded. It carries the SAME three inputs a bundle does,
// but in the link itself — so it needs no host, no fetch and no upload before
// anyone can join: the facilitator types `invite`, the room taps the link.
// The fragment never reaches a server (browsers do not send it), which keeps
// the secret exactly as private as the bearer bundle's signature kept it.
//
// THE MEETING POINT rides after the place, as `&key=value` pairs — only when
// the facilitator meets somewhere other than the default:
//   relay — the meeting point everyone dials, as its full ws(s):// URL (a
//           path such as /io included). ws:// only to a loopback host. A
//           bare `pluginthematrix.com` is READ as wss://pluginthematrix.com,
//           but never WRITTEN that way (below).
//   host  — the meeting host: where the room's shared tiles go, written as
//           `https://name.tld`.
//   code  — the meeting point's access code. It leaves the link only to the
//           meeting point itself (as the dial's subprotocol); no sheet, toast
//           or log ever shows it, and without a relay it is dropped.
// `&` never appears inside a part (every part is percent-encoded), so a link
// without one reads exactly as it always did — and every link minted before
// the meeting point keeps its meaning.
//
// AN OLDER PACKAGE MUST NOT JOIN THE WRONG PLACE. A parser from before the
// meeting point splits on '/' alone, so it reads `&relay=…&code=…` as the end
// of the secret (or of the last page) — a different zone on the default
// relay, with the code in the page name. What it DOES refuse is a part that
// decodes to text holding a '/'. So every pair this writes carries one once
// decoded — the relay as its full `wss://…` URL, the host as `https://…` —
// and a code only ever rides with a relay. An older package reads any link
// with a meeting point as malformed and does nothing (meeting-link.spec.ts
// holds the published parser to that).
//
// The shell captures it at boot (hypercomb-shared/core/invite-capture.ts,
// which mirrors MEET_KEY — keep the two literals in sync), stashing the text
// after `#meet=` VERBATIM; parseMeet below is the one validator.

/** sessionStorage key the shell stashes a `#meet=` fragment under. */
export const MEET_KEY = 'hc:pending-meet'

/** The fragment prefix a meeting link carries. */
export const MEET_PREFIX = '#meet='

const MEET_PART_MAX = 512
const MEET_SEGMENTS_MAX = 64
const RELAY_MAX = 256
const CODE_MAX = 128

/** Where a meeting is held, beyond its room — see the link above. */
export interface MeetingPoint {
  /** `ws(s)://…`, canonical (see meetingRelayOf). */
  relay?: string
  /** A bare host (`name.tld`, or `localhost:port`). */
  host?: string
  /** The meeting point's access code. */
  code?: string
}

/** A meeting link read back: the place, and where it is held. */
export type MeetingLink = MeetingInviteBundle & MeetingPoint

/** An access code travels as the WebSocket subprotocol `hc-access.<code>`,
 *  so it is exactly an HTTP token (RFC 7230 tchar) — what a browser accepts
 *  there, and nothing a header could be split on. */
const ACCESS_CODE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

/** Is `code` an access code a dial can carry? */
export function isAccessCode(code: unknown): code is string {
  return typeof code === 'string' && code.length > 0 && code.length <= CODE_MAX && ACCESS_CODE_RE.test(code)
}

const LOOPBACK_NAME_RE = /^(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])$/
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** A meeting point as the canonical `ws(s)://host[:port][/path]` — a bare
 *  domain is wss:// — or '' when it is not one: credentials, a query or a
 *  fragment, ws:// to anything but a loopback host, no real host name. */
export function meetingRelayOf(raw: unknown): string {
  let text = String(raw ?? '').trim()
  if (!text || text.length > RELAY_MAX) return ''
  if (!/^wss?:\/\//i.test(text)) text = `wss://${text}`
  let url: URL
  try { url = new URL(text) } catch { return '' }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return ''
  if (url.username || url.password || url.search || url.hash) return ''
  const name = url.hostname.toLowerCase()
  const loopback = LOOPBACK_NAME_RE.test(name)
  if (!loopback && !DOMAIN_RE.test(name)) return ''
  if (url.protocol === 'ws:' && !loopback) return ''
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host.toLowerCase()}${path}`
}

/** A meeting host as a bare `name.tld` (a port only on loopback), or ''. */
export function meetingHostOf(raw: unknown): string {
  const text = String(raw ?? '').trim().toLowerCase()
    .replace(/^(?:wss?|https?):\/\//, '').replace(/\/.*$/, '')
  if (!text || text.length > 253) return ''
  const port = /:(\d{1,5})$/.exec(text)
  const name = port ? text.slice(0, port.index) : text
  if (LOOPBACK_NAME_RE.test(name)) return port && Number(port[1]) > 0 && Number(port[1]) < 65536 ? text : name
  return !port && DOMAIN_RE.test(name) ? name : ''
}

/** The domain a meeting point's relay is on — the host it keeps tiles at by
 *  default. */
export function relayDomainOf(relay: string): string {
  try { return meetingHostOf(new URL(relay).host) } catch { return '' }
}

/** The link's fragment for (room, secret, segments) — the caller prefixes
 *  its own origin. Every part is percent-encoded, so a slash, a space or a
 *  non-Latin letter in a room survives the round trip unchanged. A meeting
 *  point rides after it (see above); one not valid is left out. */
export function meetFragment(room: string, secret: string, segments: readonly string[], point?: MeetingPoint): string {
  const place = MEET_PREFIX + [room, secret, ...segments].map(s => encodeURIComponent(s)).join('/')
  const pairs: string[] = []
  const relay = meetingRelayOf(point?.relay)
  // Always the full URL, and the host with its scheme: each decodes to text
  // with a '/', which an older parser refuses (see above) — never shortened.
  if (relay) pairs.push(`relay=${encodeURIComponent(relay)}`)
  const host = meetingHostOf(point?.host)
  if (host) pairs.push(`host=${encodeURIComponent(`https://${host}`)}`)
  // A code is for its meeting point alone — never sent to the default relay.
  if (relay && isAccessCode(point?.code)) pairs.push(`code=${encodeURIComponent(point!.code!)}`)
  return pairs.length ? `${place}&${pairs.join('&')}` : place
}

/** Read a stashed meeting fragment (with or without its `#meet=` prefix)
 *  back into a joinable link. A malformed fragment — a bad escape, a
 *  missing room or secret, a part carrying a slash, an absurd length, a
 *  meeting point that is not one — is null, and the caller ignores it.
 *  Never throws. */
export function parseMeet(raw: string): MeetingLink | null {
  let body = String(raw ?? '').trim()
  if (body.startsWith(MEET_PREFIX)) body = body.slice(MEET_PREFIX.length)
  else if (body.startsWith('meet=')) body = body.slice('meet='.length)
  // Some other fragment altogether (`#other=…`) is not a meeting link.
  if (!body || body.startsWith('#')) return null
  const amp = body.indexOf('&')
  const placeText = amp < 0 ? body : body.slice(0, amp)
  const point = amp < 0 ? {} : parsePoint(body.slice(amp + 1))
  if (!point) return null
  const encoded = placeText.split('/')
  if (encoded.length < 2 || encoded.length > MEET_SEGMENTS_MAX + 2) return null
  const parts: string[] = []
  for (const e of encoded) {
    let part: string
    try { part = decodeURIComponent(e) } catch { return null }
    if (part.length > MEET_PART_MAX || SLASH_RE.test(part)) return null
    parts.push(part)
  }
  const [room, secret, ...rest] = parts
  if (!room.trim() || !secret.trim()) return null
  const bundle = validateInviteBundle({
    kind: MEETING_INVITE_KIND,
    v: MEETING_INVITE_VERSION,
    segments: rest.filter(s => s.trim().length > 0),
    room,
    secret,
  })
  return bundle ? { ...bundle, ...point } : null
}

/** `relay=…&host=…&code=…` → a meeting point; null when a named value is
 *  not valid (a link that names a meeting point it cannot reach must not
 *  quietly join the default one instead). Unknown keys are ignored, the
 *  first of a repeated key wins. */
function parsePoint(text: string): MeetingPoint | null {
  const point: MeetingPoint = {}
  for (const pair of text.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    let value: string
    try { value = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1)) } catch { return null }
    if (key === 'relay' && point.relay === undefined) {
      const relay = meetingRelayOf(value)
      if (!relay) return null
      point.relay = relay
    } else if (key === 'host' && point.host === undefined) {
      const host = meetingHostOf(value)
      if (!host) return null
      point.host = host
    } else if (key === 'code' && point.code === undefined) {
      if (!isAccessCode(value)) return null
      point.code = value
    }
  }
  // A code is for its meeting point alone: with none named, it goes nowhere.
  if (point.code !== undefined && point.relay === undefined) delete point.code
  return point
}

// ── Tile-borne invites ────────────────────────────────────────────────
//
// An invite can also live ON a tile as a decoration. The tile becomes an
// AUTH-SWITCH JUNCTION: a peer who witnesses it over the swarm sees an
// invite icon and can click to switch into the encoded meeting place — a
// portal between two hives' swarms.

/** Decoration kind for a tile-borne swarm invite. */
export const SWARM_INVITE_KIND = 'swarm:invite'

/** Payload of a `swarm:invite` decoration. References the invite bundle
 *  resource by signature (the bundle holds {segments, room, secret}) — the
 *  decoration itself stays a lightweight pointer, per the signature
 *  doctrine. */
export interface InviteDecorationPayload {
  bundleSig: string
}

/** Canonical bytes for the bundle. Stable key order → stable signature, so
 *  the same meeting place always content-addresses to the same sig
 *  (dedup across re-shares). */
export function encodeInviteBundle(b: MeetingInviteBundle): Blob {
  const ordered = {
    kind: b.kind,
    v: b.v,
    segments: b.segments,
    room: b.room,
    // Never the secret: these bytes go to a host (see `secret` above).
    ...(b.secretCheck ? { secretCheck: b.secretCheck } : {}),
    ...(b.alias ? { alias: b.alias } : {}),
    ...(b.createdAt ? { createdAt: b.createdAt } : {}),
  }
  return new Blob([JSON.stringify(ordered)], { type: 'application/json' })
}

/** The check a stored invite carries in place of its secret: SHA-256 of a
 *  fixed label, the room and the secret. It names the secret without holding
 *  it. */
export async function inviteSecretCheck(room: string, secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(`hypercomb:invite\0${room}\0${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** The secret an invite opens with, or null: the bundle's own (a meeting
 *  link, or a bundle minted before 2026-10-07), else the first candidate —
 *  the link's fragment, then the secret the participant already holds —
 *  that matches the bundle's check. */
export async function resolveInviteSecret(
  bundle: MeetingInviteBundle,
  candidates: readonly (string | null | undefined)[],
): Promise<string | null> {
  if (bundle.secret) return bundle.secret
  if (!bundle.secretCheck) return null
  for (const candidate of candidates) {
    const secret = String(candidate ?? '').trim()
    if (secret && await inviteSecretCheck(bundle.room, secret) === bundle.secretCheck) return secret
  }
  return null
}

/** The fragment an invite link carries its secret in — `/<sig>#invite-secret=…`.
 *  A fragment never reaches a server. Captured at boot (shell
 *  invite-capture.ts) under PENDING_INVITE_SECRET_KEY. */
export const INVITE_SECRET_PREFIX = '#invite-secret='
export const PENDING_INVITE_SECRET_KEY = 'hc:pending-invite-secret'
