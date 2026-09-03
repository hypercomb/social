// canon.mjs — the REAL canonicalization rule, lifted verbatim from
// hypercomb-essentials/src/history/lineage-key.ts.
//
// NFC-normalize, replace every run of non-(letter|digit) with a single hyphen,
// strip edge hyphens. Case is PRESERVED. Letters/digits of any script survive.
//
// In the molecule model this rule no longer builds a PATH key — it builds the
// preimage of one NAME. `lineageKey` is kept only so tests can compare the old
// path-keyed address with the new name-keyed one.

const SEPARATORS = /[^\p{L}\p{N}]+/gu
const EDGE_HYPHENS = /^-+|-+$/g

/** Canonicalize ONE segment / name. May return '' for a symbol-only string. */
export const canonicalizeSegment = (raw) =>
  String(raw ?? '')
    .normalize('NFC')
    .replace(SEPARATORS, '-')
    .replace(EDGE_HYPHENS, '')

/**
 * The canonical NAME — the exact preimage hashed into a molecule address.
 * Same guard as lineageKey: a non-empty symbol-only name falls back to its
 * trimmed raw form rather than collapsing to '' (which is the ROOT molecule).
 */
export const canonName = (raw) => canonicalizeSegment(raw) || String(raw ?? '').trim()

/** LEGACY: the path-keyed preimage. Kept for comparison tests only. */
export const lineageKey = (segments) =>
  (Array.isArray(segments) ? segments : [])
    .map((raw) => canonicalizeSegment(raw) || String(raw ?? '').trim())
    .filter((s) => s.length > 0)
    .join('/')
