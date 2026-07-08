// diamondcoreprocessor.com/history/lineage-key.ts
//
// Canonical lineage-key derivation — the SINGLE source of truth for turning a
// lineage's path segments into the string that gets hashed. Two consumers must
// agree on it byte-for-byte:
//   - HistoryService.sign      → the local history sigbag address (<root>/<sig>/)
//   - SwarmDrone (compose/sync/publish/wipe) → the mesh channel sig
// and, for parity, ShowCellDrone.computeSignatureLocation's returned key.
//
// WHY canonicalize. A sigbag's identity IS its ancestry. Two paths a human
// reads as "the same place" must hash identically, or their history and mesh
// slot silently fork — "signature bags that are the same but don't match".
// Names arrive from many sources (typed, pasted, shared links, AI, back/forward
// URLs) carrying invisible variation: en-dash vs hyphen, non-breaking vs normal
// space, smart vs straight quotes, trailing punctuation, doubled spaces. We fold
// all of that away BEFORE hashing so equivalent names converge on one bag — and
// so two independent peers navigating to the same place compose the same mesh
// sig.
//
// THE RULE. NFC-normalize, replace every run of non-(letter|digit) with a single
// hyphen, strip edge hyphens. Letters and digits of ANY script survive (so
// "Chapter 1", "café", "日本語" keep their identity — digits are content, and
// stripping to ASCII would collapse every non-Latin name). Case is preserved.
// Collapsing separators to a hyphen (rather than deleting) keeps word boundaries
// — "AB-CD" can't collide with a real "ABCD" — and yields a slug that reads as a
// conventional token: the same canonical segment doubles as an i18n key, so a
// curated tile ("my-cool-tile") can carry an en.json / ja.json translation.
// (t(key) works with ANY string — the hyphen is convention, not a requirement —
// and it means an already-hyphenated name canonicalizes to itself, so slug-shaped
// names need no migration. A space-containing name like "Chapter 1" DOES fold to
// "Chapter-1", so it re-addresses; the #rawAlias union in HistoryService migrates
// it non-destructively.)
//
// SCOPE: sig-side ONLY. The URL, the explorer path, and on-disk folder names
// stay lossless (see lineage.ts) — "My-Tile" still displays as "My-Tile". We
// normalize only the preimage that gets hashed.

/** Any run of characters that is neither a Unicode letter nor a Unicode
 *  number. These are the "separators" we flatten to a single hyphen. */
const SEPARATORS = /[^\p{L}\p{N}]+/gu

/** Leading / trailing hyphens left after the separator swap (trim only removes
 *  edge whitespace, and whitespace has already become '-' by then). */
const EDGE_HYPHENS = /^-+|-+$/g

/**
 * Canonicalize ONE lineage segment: NFC, then every run of
 * punctuation/whitespace → a single hyphen, then strip edge hyphens.
 *
 * Idempotent — canonicalizing an already-canonical segment is a no-op, so it is
 * safe to apply at any join site regardless of whether the segments were built
 * from raw display names or a prior canonical form.
 *
 * May return '' for a segment that is entirely symbols/emoji (no letters or
 * digits). Callers that build a path key must NOT silently drop such a segment —
 * see `lineageKey`.
 */
export const canonicalizeLineageSegment = (raw: unknown): string =>
  String(raw ?? '').normalize('NFC').replace(SEPARATORS, '-').replace(EDGE_HYPHENS, '')

/**
 * The canonical key for a lineage path — the exact preimage hashed into a
 * sigbag address. Canonicalize each segment, drop segments that were empty to
 * begin with, join with '/'. After canonicalization no segment can contain '/',
 * so '/' stays an unambiguous separator.
 *
 * Guard: if a NON-empty raw segment canonicalizes to '' (a symbol/emoji-only
 * name), fall back to its trimmed raw form instead of dropping it. Dropping it
 * would shorten the path — colliding with the parent — or, for a single such
 * segment at the root, collapse the key to '' and collide with the
 * empty-content ROOT sig (the root-bag/empty-hash collision). A symbol-only
 * name stays distinct as its raw self.
 */
export const lineageKey = (segments: readonly unknown[]): string =>
  (Array.isArray(segments) ? segments : [])
    .map((raw): string => canonicalizeLineageSegment(raw) || String(raw ?? '').trim())
    .filter((s: string) => s.length > 0)
    .join('/')

/**
 * The LEGACY (pre-canonicalization) key: trim + drop-empty + join, with NO
 * punctuation folding — exactly what `HistoryService.sign` hashed before
 * canonicalization existed.
 *
 * Used ONLY for migration: when canonicalization changes a lineage's key,
 * HistoryService unions the bag stored under this old raw-key sig into the new
 * canonical bag, so a punctuation-named tile keeps its committed history and
 * head layer. Never a WRITE destination.
 */
export const rawLineageKey = (segments: readonly unknown[]): string =>
  (Array.isArray(segments) ? segments : [])
    .map((x: unknown) => String(x ?? '').trim())
    .filter((s: string) => s.length > 0)
    .join('/')
