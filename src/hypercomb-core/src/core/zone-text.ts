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
