// diamondcoreprocessor.com/history/head-index.ts
//
// Pure logic for the persisted per-lineage head index (`hc:history:head-index`).
//
// The index is a DERIVED CACHE of on-disk truth: each lineage sigbag's max
// marker → the layer sig it points at. Per the optimize-phase doctrine
// (src/documentation/optimize-phase.md) a derived cache must never be
// load-bearing — and this one has the doctrine's exact anti-pattern baked
// into its key: the cache key (lineageSig) does NOT change when the source
// changes (a new marker lands in the same bag). Two rules make it safe:
//
//   1. Every entry carries the marker FILENAME it was derived from (`m`),
//      so a filename-only dir check detects staleness without reading a
//      byte. Restored entries are UNTRUSTED until that check passes
//      (HistoryService.#validateRestoredHead).
//   2. A flush may only overwrite entries the session itself derived or
//      committed (`owned`) and remove entries it deleted (`dropped`);
//      everything else passes through byte-identical. A boot that restored
//      a stale snapshot can no longer re-persist it over lineages it never
//      looked at.
//
// Why this exists (2026-07-16, dev 4250): a frozen tab lost the debounced
// flush; the next boot restored older heads, trusted them because their
// bytes still resolved (content-addressed bytes always resolve), whole-map
// re-flushed the stale snapshot, and ~100 fresh commits silently regressed
// — some permanently, once cascades minted new markers from the stale
// layers. The lineage bags (max marker wins) held the truth throughout.

export type HeadIndexEntry = { readonly s: string; readonly m?: string }
export type HeadIndexFile = Record<string, HeadIndexEntry>

const SIG_RE = /^[a-f0-9]{64}$/
const MARKER_RE = /^\d{8}$/

/**
 * Parse a persisted index. Accepts the current `{ s, m? }` entry shape AND
 * the legacy plain-string shape (value = layer sig, no stamp — validates by
 * full re-derivation). Junk entries are dropped silently: a corrupt cache
 * costs a cold derivation, never an error and never a trusted lie.
 */
export function parseHeadIndex(raw: string | null): HeadIndexFile {
  const out: HeadIndexFile = {}
  if (!raw) return out
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return out }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out
  for (const [lineageSig, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SIG_RE.test(lineageSig)) continue
    if (typeof value === 'string') {
      // Legacy shape: bare layer sig, no marker stamp.
      if (SIG_RE.test(value)) out[lineageSig] = { s: value }
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const s = (value as { s?: unknown }).s
      const m = (value as { m?: unknown }).m
      if (typeof s !== 'string' || !SIG_RE.test(s)) continue
      out[lineageSig] = typeof m === 'string' && MARKER_RE.test(m) ? { s, m } : { s }
    }
  }
  return out
}

/**
 * Compose the index to persist. Starts from what is ALREADY stored and
 * overlays ONLY the lineages this session actually derived from the bag or
 * committed (`owned`); lineages the session deleted (`dropped`) are removed.
 * Entries merely RESTORED from a previous session pass through untouched.
 *
 * `heads` is the live in-memory head map; an `owned` lineage missing from
 * it (deleted without being marked dropped — defensive) is skipped rather
 * than invented.
 */
export function buildFlushIndex(
  existing: HeadIndexFile,
  heads: ReadonlyMap<string, string>,
  stamps: ReadonlyMap<string, string>,
  owned: ReadonlySet<string>,
  dropped: ReadonlySet<string>,
): HeadIndexFile {
  const out: HeadIndexFile = { ...existing }
  for (const lineageSig of dropped) delete out[lineageSig]
  for (const lineageSig of owned) {
    const s = heads.get(lineageSig)
    if (!s || !SIG_RE.test(s)) continue
    const m = stamps.get(lineageSig)
    out[lineageSig] = m && MARKER_RE.test(m) ? { s, m } : { s }
  }
  return out
}
