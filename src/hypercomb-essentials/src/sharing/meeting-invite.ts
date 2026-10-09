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
  /** Access secret (SecretStore). Folds into the channel sig. Required, non-empty. */
  secret: string
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
  const secret = o['secret']
  if (typeof room !== 'string' || !room.trim()) return null
  if (typeof secret !== 'string' || !secret.trim()) return null

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
    secret: secret.trim(),
    ...(alias ? { alias } : {}),
    ...(createdAt ? { createdAt } : {}),
  }
}

// ── The meeting link ──────────────────────────────────────────────────
//
// `https://<origin>/#meet=<room>/<secret>[/<segment>...]`, each part
// percent-encoded. It carries the SAME three inputs a bundle does, but in the
// link itself — so it needs no host, no fetch and no upload before anyone can
// join: the facilitator types `invite`, the room taps the link. The fragment
// never reaches a server (browsers do not send it), which keeps the secret
// exactly as private as the bearer bundle's signature kept it.
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

/** The link's fragment for (room, secret, segments) — the caller prefixes
 *  its own origin. Every part is percent-encoded, so a slash, a space or a
 *  non-Latin letter in a room survives the round trip unchanged. */
export function meetFragment(room: string, secret: string, segments: readonly string[]): string {
  return MEET_PREFIX + [room, secret, ...segments].map(s => encodeURIComponent(s)).join('/')
}

/** Read a stashed meeting fragment (with or without its `#meet=` prefix)
 *  back into a joinable bundle. A malformed fragment — a bad escape, a
 *  missing room or secret, a part carrying a slash, an absurd length — is
 *  null, and the caller ignores it. Never throws. */
export function parseMeet(raw: string): MeetingInviteBundle | null {
  let body = String(raw ?? '').trim()
  if (body.startsWith(MEET_PREFIX)) body = body.slice(MEET_PREFIX.length)
  else if (body.startsWith('meet=')) body = body.slice('meet='.length)
  // Some other fragment altogether (`#other=…`) is not a meeting link.
  if (!body || body.startsWith('#')) return null
  const encoded = body.split('/')
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
  return validateInviteBundle({
    kind: MEETING_INVITE_KIND,
    v: MEETING_INVITE_VERSION,
    segments: rest.filter(s => s.trim().length > 0),
    room,
    secret,
  })
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
    secret: b.secret,
    ...(b.alias ? { alias: b.alias } : {}),
    ...(b.createdAt ? { createdAt: b.createdAt } : {}),
  }
  return new Blob([JSON.stringify(ordered)], { type: 'application/json' })
}
