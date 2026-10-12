// core/zone-text.ts
//
// THE ROOM AND THE SECRET AS ENTERED — one text, one zone.
//
// A swarm zone is sha256(`lifecycle\0room\0secret`) of the text exactly as
// held, so two people who type what LOOKS like the same room must hold the
// same bytes or they meet in two rooms while their screens agree. Text
// arrives carrying invisible variation: a zero-width space copied out of a
// chat, an IME in full-width mode ('ｄｏｗｎｔｏｗｎ'), a decomposed accent
// pasted from a macOS file name, iOS smart punctuation (joe’s, north—side),
// a no-break space from Option+Space, a doubled space. Every entry path (the
// selector, a #meet link, `use-live-relay`, an invite) folds it here, once,
// before the text becomes a zone.
//
// THE RULE, in order:
//   1. NFKC — compatibility forms fold to their plain form: full-width and
//      half-width letters, no-break and ideographic spaces, composed vs
//      decomposed accents.
//   2. Drop format characters (\p{Cf}: zero-width space/joiners, word joiner,
//      BOM, soft hyphen, bidi marks) and the non-whitespace control
//      characters (a NUL would also forge the `\0` the zone preimage is
//      joined with).
//   3. Straighten smart punctuation: ‘ ’ ‚ ‛ → ' and “ ” „ ‟ → ", the
//      hyphen-like dashes (‐ ‑ ‒ – −) → -, and the long dashes (— ―) → --,
//      which is what smart punctuation made of a typed '--'.
//   4. Collapse every whitespace run to one space, and trim.
//
// Case is KEPT: the zone is case-sensitive by design ('Garden' is not
// 'garden'). Printable ASCII with single spaces is unchanged, so every zone
// anyone already meets in hashes exactly as before. Idempotent.
//
// Folding is for ENTRY. A pair a tab already holds (resumed from its own
// record) is kept as recorded; see hypercomb-shared/core/mesh-session.ts.

const FORMAT_AND_CONTROL = /[\p{Cf}\u0000-\u0008\u000E-\u001F\u007F-\u009F]/gu
const SINGLE_QUOTES = /[‘’‚‛]/g
const DOUBLE_QUOTES = /[“”„‟]/g
const SHORT_DASHES = /[‐‑‒–−]/g
const LONG_DASHES = /[—―]/g
const WHITESPACE_RUN = /\s+/g

/** A room or secret as one canonical text (see the rule above). Anything
 *  that is not a string reads as ''. Never throws. */
export const canonicalZoneText = (text: unknown): string => {
  if (typeof text !== 'string' || !text) return ''
  let s = text
  try { s = s.normalize('NFKC') } catch { /* an engine without normalize: the rest still folds */ }
  return s
    .replace(FORMAT_AND_CONTROL, '')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(SHORT_DASHES, '-')
    .replace(LONG_DASHES, '--')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
}

// ── THE ROOM IS MEETING POINT + ROOM + SECRET ─────────────────────────────
//
// jwize, 2026-10-12: "hash or however we do it (host+location+secret) gen
// keywords from those". A room's every address — its lifecycle channel, its
// page channels, its members' personal channels, its ask channel — and its
// two comparison words come from ONE preimage tail: the room, the secret and
// the MEETING POINT the tab attaches to. The point is ALWAYS part of it, the
// shipped default included ("the host field isn't filled by default"): an
// empty field resolves to wss://hypercomb.com, so an empty field and
// 'hypercomb.com' are one room, and the same words at another point are
// another room with another pair. One meeting point per meeting.
//
// The point is the RESOLVED relay this tab dials (nostr-mesh swarmHost), as
// its lowercase host[:port] — never a replication host (the hosts pool, a
// publish domain, an upload host): those keep bytes, they do not define who
// meets. "Location" is the ROOM, never the page path: everyone in a room
// reads one pair wherever they stand.
//
// A room from before this (2026-10-12) hashed `lifecycle\0room\0secret`;
// every room has a new address now, and a package from before will not meet
// one from after (documentation/swarm-room-identity.md).

/** The shipped default meeting point — nostr-mesh LIVE_RELAY. An empty
 *  meeting-point field resolves to it. */
export const SHIPPED_MEETING_POINT = 'wss://hypercomb.com'

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

const hostOf = (text: string): string => {
  try { return new URL(SCHEME.test(text) ? text : `wss://${text}`).host.toLowerCase() } catch { return '' }
}

/** A meeting point as a room's identity names it: its lowercase
 *  host[:port] ('wss://HyperComb.com/' → 'hypercomb.com', 'ws://localhost:7777'
 *  → 'localhost:7777'); an empty field, or one that is no address, is the
 *  shipped default's host. Never ''. Never throws. */
export const meetingPointKey = (point: unknown): string => {
  const text = typeof point === 'string' ? point.trim() : ''
  return (text && hostOf(text)) || hostOf(SHIPPED_MEETING_POINT)
}

/** THE ROOM'S PREIMAGE TAIL: `room \0 secret \0 point`. Every room address is
 *  sign(`<label> \0 ` + this) and nothing else names the room. */
export const roomPreimage = (room: string, secret: string, point: unknown): string =>
  `${room}\0${secret}\0${meetingPointKey(point)}`

/** The room's lifecycle channel preimage — its roster address, and the text
 *  its two comparison words are drawn from (core secretTag). */
export const lifecyclePreimage = (room: string, secret: string, point: unknown): string =>
  `lifecycle\0${roomPreimage(room, secret, point)}`
