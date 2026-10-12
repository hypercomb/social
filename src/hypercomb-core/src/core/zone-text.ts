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
// Case is KEPT in the text (it is what the participant typed, and what the
// selector shows back); the ROOM folds it — see roomPreimage. Idempotent.
//
// Folding is for ENTRY. A pair a tab already holds (resumed from its own
// record) is kept as recorded; see hypercomb-shared/core/mesh-session.ts.

import { fold } from './molecule-address.js'

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

// ── THE ROOM IS HOST + ROOM + SECRET ──────────────────────────────────────
//
// jwize, 2026-10-12: "hash or however we do it (host+location+secret) gen
// keywords from those"; 2026-10-11: "the host needs to be part of the name
// generation so they meet at the same location and server". A room's every
// address — its lifecycle channel, its page channels, its members' personal
// channels, its ask channel — and its two comparison words come from ONE
// preimage tail: the room, the secret and the HOST the participant named to
// meet at. Same host + room + secret: the same words and the same addresses,
// so they meet. Another host: other words and other addresses, so they never
// meet — two names for one physical relay (localhost:7777 and jwize.com on
// one PC) are two rooms, on purpose. One meeting point per meeting.
//
// The host is the RESOLVED relay this tab dials (nostr-mesh swarmHost), as
// its lowercase host[:port] — never a replication host (the hosts pool, a
// publish domain, an upload host): those keep bytes, they do not define who
// meets. And NEVER THE PAGE (jwize, 2026-10-11: "The domain on the other
// hand should not be used (current address in the browser)"): the page's
// own origin — hypercomb.io, localhost:4250, a published site — names no
// room, picks no host and is shown beside no words. "Location" is the ROOM,
// never the page path: everyone in a room reads one pair wherever they stand.
//
// NO HOST, NO ROOM. There is no default host (jwize, 2026-10-11: "Let's just
// make sure that there isn't a default host"): with no host named there is
// no preimage — '' — so no address and no words. Every caller reads '' as
// "not in a room yet", never as a room of its own.
//
// A room from before 2026-10-12 hashed `lifecycle\0room\0secret`; every room
// has a new address now, so a package from before does not meet one from
// after at the same host — their words differ; update to meet
// (documentation/swarm-room-identity.md).

/** hypercomb.com, the open always-online meeting point — OFFERED (one tap
 *  fills the host field), never a default: an empty host is no room. The
 *  literal also lives in nostr-mesh LIVE_RELAY (status.truth.spec holds the
 *  two together). */
export const SHIPPED_MEETING_POINT = 'wss://hypercomb.com'

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

const hostOf = (text: string): string => {
  try { return new URL(SCHEME.test(text) ? text : `wss://${text}`).host.toLowerCase() } catch { return '' }
}

/** A host as a room's identity names it: its lowercase host[:port]
 *  ('wss://HyperComb.com/' → 'hypercomb.com', 'ws://localhost:7777' →
 *  'localhost:7777'). '' for an empty field or one that is no address —
 *  never a default. Never throws. */
export const meetingPointKey = (point: unknown): string => {
  const text = typeof point === 'string' ? point.trim() : ''
  return text ? hostOf(text) : ''
}

/** The room or secret as a ROOM names it: the canonical entry text (above),
 *  case-folded (jwize, 2026-10-12: "case ignore or it would be confusing" —
 *  'MyNewRoom' and 'mynewroom' are one room). The fold is core's
 *  locale-INDEPENDENT one (molecule-address `fold`, toLowerCase — never
 *  toLocaleLowerCase, which maps 'I' differently under a Turkish locale), so
 *  every device in every language derives the same room. Room and secret are
 *  NOT pools of meaning: nothing else is folded away (punctuation stays). */
export const roomText = (text: unknown): string => fold(canonicalZoneText(text))

/** THE ROOM'S PREIMAGE TAIL: `room \0 secret \0 host`, each as a room names
 *  it (roomText, meetingPointKey). Every room address is
 *  sign(`<label> \0 ` + this) and nothing else names the room. '' when no
 *  host is named: there is no room, so there is nothing to sign — a caller
 *  that gets '' derives no address. Deterministic for everyone: no page, no
 *  locale, no clock, no version (zone-text.spec.ts freezes golden vectors). */
export const roomPreimage = (room: string, secret: string, point: unknown): string => {
  const host = meetingPointKey(point)
  return host ? `${roomText(room)}\0${roomText(secret)}\0${host}` : ''
}

/** The room's lifecycle channel preimage — its roster address, and the text
 *  its two comparison words are drawn from (core secretTag). '' when no host
 *  is named (no room, no words). */
export const lifecyclePreimage = (room: string, secret: string, point: unknown): string => {
  const tail = roomPreimage(room, secret, point)
  return tail ? `lifecycle\0${tail}` : ''
}
