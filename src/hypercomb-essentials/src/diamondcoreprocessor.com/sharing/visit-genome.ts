// diamondcoreprocessor.com/sharing/visit-genome.ts
//
// The VISIT GENOME — the durable record of the path a participant has
// drilled through other people's tiles in a swarm.
//
// Doctrine (visit-driven acquisition): there is no adopt button. Walking
// into a peer-offered tile IS the acquisition gesture — the tile folds
// into the participant's own hive one level at a time, and this ledger
// remembers, per visited path, the publisher handle the fold rode:
//
//   { segments, layerSig, pubkey, domain, atMs }
//
// segments  — where the tile lives in the VISITOR's hive (the visited path)
// layerSig  — the publisher's sealed merkle handle for that subtree at
//             visit time; a permanent content-addressed pointer, fetchable
//             from any host that serves it long after the peer is gone
// pubkey    — the publisher it was witnessed from
// domain    — a byte host learned for that sig (offline retrieval)
// atMs      — last visit time (re-visits refresh the record)
//
// Participant-local by the same argument as adopted-roots: folding any of
// this into the layer would skew lineage sigs across peers. localStorage,
// one JSON map, parse-cached (the adopted-roots per-call re-parse is a
// known scaling hazard — this ledger grows with every drill, so it caches).
//
// The ledger is NOT load-bearing for rendering or history — losing it
// loses provenance ("where did I meet this tile"), never content: the
// folds themselves are ordinary committed layers.

const VISIT_GENOME_KEY = 'hc:visit-genome'
const MAX_RECORDS = 2048
const SIG_RE = /^[0-9a-f]{64}$/

export interface VisitRecord {
  segments: string[]
  layerSig: string
  pubkey: string
  domain?: string
  atMs: number
}

const keyOf = (segments: readonly string[]): string =>
  segments.map(s => String(s ?? '').trim()).filter(Boolean).join('\u0000')

// Parse cache — invalidated on every write through this module. A
// different-tab writer is not coherent here, which matches the one-tab
// rule the packed store already imposes.
let cache: Map<string, VisitRecord> | null = null

const load = (): Map<string, VisitRecord> => {
  if (cache) return cache
  const out = new Map<string, VisitRecord>()
  try {
    const raw = localStorage.getItem(VISIT_GENOME_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const r = v as Partial<VisitRecord> | null
        if (!r || !Array.isArray(r.segments) || r.segments.length === 0) continue
        const layerSig = String(r.layerSig ?? '').toLowerCase()
        const pubkey = String(r.pubkey ?? '').toLowerCase()
        if (!SIG_RE.test(layerSig) || !SIG_RE.test(pubkey)) continue
        out.set(k, {
          segments: r.segments.map(s => String(s ?? '').trim()).filter(Boolean),
          layerSig,
          pubkey,
          domain: typeof r.domain === 'string' && r.domain.trim() ? r.domain.trim() : undefined,
          atMs: Number.isFinite(r.atMs) ? Number(r.atMs) : 0,
        })
      }
    }
  } catch { /* corrupt / absent — start empty */ }
  cache = out
  return out
}

const persist = (map: Map<string, VisitRecord>): void => {
  try {
    localStorage.setItem(VISIT_GENOME_KEY, JSON.stringify(Object.fromEntries(map)))
  } catch { /* no localStorage — the genome degrades to this session */ }
}

/** Record (or refresh) a visited tile. Oldest records are evicted past the
 *  cap — the genome is provenance, not truth, so eviction loses nothing
 *  the folded layers don't already hold. */
export const recordVisit = (rec: {
  segments: readonly string[]
  layerSig: string
  pubkey: string
  domain?: string
}): void => {
  const segments = rec.segments.map(s => String(s ?? '').trim()).filter(Boolean)
  const layerSig = String(rec.layerSig ?? '').toLowerCase()
  const pubkey = String(rec.pubkey ?? '').toLowerCase()
  if (segments.length === 0 || !SIG_RE.test(layerSig) || !SIG_RE.test(pubkey)) return
  const map = load()
  map.set(keyOf(segments), {
    segments,
    layerSig,
    pubkey,
    domain: rec.domain?.trim() || undefined,
    atMs: Date.now(),
  })
  if (map.size > MAX_RECORDS) {
    const oldest = [...map.entries()].sort((a, b) => a[1].atMs - b[1].atMs)
    for (let i = 0; i < map.size - MAX_RECORDS; i++) map.delete(oldest[i][0])
  }
  persist(map)
}

/** The record for one visited path, or null. */
export const visitRecordAt = (segments: readonly string[]): VisitRecord | null =>
  load().get(keyOf(segments)) ?? null

/** Every visit record, newest first. */
export const visitRecords = (): VisitRecord[] =>
  [...load().values()].sort((a, b) => b.atMs - a.atMs)

/** Drop records at/beneath a path — the delete-side hygiene twin of the
 *  adopt tombstone (a deleted tile's provenance should not linger). */
export const dropVisitsWithin = (segments: readonly string[]): void => {
  const prefix = keyOf(segments)
  if (!prefix) return
  const map = load()
  let changed = false
  for (const k of [...map.keys()]) {
    if (k === prefix || k.startsWith(prefix + '\u0000')) { map.delete(k); changed = true }
  }
  if (changed) persist(map)
}

/** Test seam — reset the parse cache (specs swap localStorage under us). */
export const _resetVisitGenomeCache = (): void => { cache = null }
