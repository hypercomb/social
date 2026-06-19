// diamondcoreprocessor.com/sharing/meeting-invite.ts
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
