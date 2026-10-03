// sharing/adopted-roots.ts
//
// Participant-local registry of adopted subtree roots — and its inverse,
// adopt tombstones (the participant's revocations).
//
// Written by SwarmAdoptDrone whenever a branch is folded/synced into the
// hive; read by the viewport first-visit seed (editor/viewport-store.ts) to
// decide whether to fit-to-content the FIRST time the participant opens a
// location inside an adopted branch, and by the auto-sync pass to decide
// which held tiles follow their publisher.
//
// Why participant-local (localStorage, NOT the layer / sigbag)
// ─────────────────────────────────────────────────────────────
// "Which branches did I adopt" is local view state, exactly like viewport,
// clipboard, selection and cursor. Folding it into the content-addressed
// layer would skew the lineage signature across peers (two participants who
// adopted the same content but in a different order would hash to different
// roots) and break dedup/sharing. So it lives outside history, keyed by the
// adopted root's segment PATH — a prefix of every descendant location.

const KEY = 'hc:adopted-roots'
const TOMBSTONE_KEY = 'hc:adopt-tombstones'
const CARRIED_KEY = 'hc:carried-roots'
const SEP = ''

// Parse cache — these predicates run in hot paths now (the render loop's
// collection rim, the divergence scan's per-tile sweep), and re-parsing a
// localStorage JSON blob per call was a flagged scaling hazard. Writes in
// this module invalidate; a different tab is not coherent here, which
// matches the one-tab rule the packed store already imposes.
const pathCache = new Map<string, string[][]>()

const readPaths = (key: string): string[][] => {
  const cached = pathCache.get(key)
  if (cached) return cached
  let paths: string[][] = []
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    paths = Array.isArray(parsed) ? parsed.filter(Array.isArray) : []
  } catch { /* corrupt / absent — empty */ }
  pathCache.set(key, paths)
  return paths
}

const writePaths = (key: string, paths: string[][]): void => {
  pathCache.delete(key)
  try { localStorage.setItem(key, JSON.stringify(paths)) } catch { /* quota — best effort */ }
}

/** Test seam — specs swap localStorage under the module. */
export const _resetAdoptedRootsCache = (): void => { pathCache.clear() }

/** True when `prefix` is a non-empty element-wise prefix of (or equal to) `segs`. */
const isPrefixOf = (prefix: readonly string[], segs: readonly string[]): boolean =>
  prefix.length > 0 && prefix.length <= segs.length && prefix.every((p, i) => p === segs[i])

const normalize = (segments: readonly string[]): string[] =>
  segments.map(s => String(s ?? '').trim()).filter(Boolean)

/**
 * Record an adopted branch root (its full segment path, e.g. `[...at, name]`).
 * Idempotent — re-adopting the same path is a no-op.
 */
export const markAdoptedRoot = (segments: readonly string[]): void => {
  const segs = normalize(segments)
  if (segs.length === 0) return
  const roots = readPaths(KEY)
  const key = segs.join(SEP)
  if (roots.some(r => r.join(SEP) === key)) return
  roots.push(segs)
  writePaths(KEY, roots)
}

/**
 * Forget adopted roots at or beneath `segments` — the delete-side inverse of
 * markAdoptedRoot. Deleting a tile takes its whole branch with it, so any
 * adopted root that IS the deleted path or lives beneath it goes too.
 * Ancestor roots stay: siblings under them are still adopted.
 */
export const unmarkAdoptedRoot = (segments: readonly string[]): void => {
  const segs = normalize(segments)
  if (segs.length === 0) return
  const roots = readPaths(KEY)
  const kept = roots.filter(r => !isPrefixOf(segs, r))
  if (kept.length !== roots.length) writePaths(KEY, kept)
}

/**
 * True when `segments` is an adopted root OR a descendant of one (prefix
 * match), so the first-visit fit applies to the adopted top AND every page
 * beneath it.
 */
export const isWithinAdoptedRoot = (segments: readonly string[]): boolean => {
  if (segments.length === 0) return false
  const segs = segments.map(s => String(s ?? ''))
  return readPaths(KEY).some(root => isPrefixOf(root, segs))
}

// ── adopt tombstones — delete is the unsubscribe ─────────────────────
//
// Written when the participant deletes a tile inside an adopted branch;
// consulted by the auto-sync pass so the publisher's copy is never folded
// back over a deliberate deletion. Cleared ONLY by an explicit adopt/sync
// gesture on that tile — that's the way back in. Prefix semantics: a
// tombstone covers its path and everything beneath it.

/** Record a revocation at `segments`. A stone that covers deeper existing
 *  stones absorbs them; a path already covered is a no-op. */
export const markAdoptTombstone = (segments: readonly string[]): void => {
  const segs = normalize(segments)
  if (segs.length === 0) return
  const stones = readPaths(TOMBSTONE_KEY)
  if (stones.some(t => isPrefixOf(t, segs))) return
  const kept = stones.filter(t => !isPrefixOf(segs, t))
  kept.push(segs)
  writePaths(TOMBSTONE_KEY, kept)
}

/** Clear revocations touching `segments` — stones at it, beneath it, AND
 *  ancestors covering it (an explicit re-adopt must actually take effect;
 *  un-revoked siblings stay safe because they are no longer held locally). */
export const clearAdoptTombstone = (segments: readonly string[]): void => {
  const segs = normalize(segments)
  if (segs.length === 0) return
  const stones = readPaths(TOMBSTONE_KEY)
  const kept = stones.filter(t => !isPrefixOf(segs, t) && !isPrefixOf(t, segs))
  if (kept.length !== stones.length) writePaths(TOMBSTONE_KEY, kept)
}

/** True when `segments` is covered by a revocation (a stone at it or above). */
export const isAdoptTombstoned = (segments: readonly string[]): boolean => {
  if (segments.length === 0) return false
  const segs = segments.map(s => String(s ?? ''))
  return readPaths(TOMBSTONE_KEY).some(t => isPrefixOf(t, segs))
}

// ── carried roots — a peer's tile the participant moved ──────────────
//
// An adopted root is keyed by its PATH, so a peer's tile cut or copied out
// of its branch and pasted onto one of the participant's own pages leaves the
// record behind — and cutting an adopted root unsubscribes it outright. The
// words inside are still the peer's. The clipboard decides "from a peer" when
// the tile is taken (`ClipboardEntry.fromPeer`) and marks where it lands
// here. A carried root drives NOTHING in the swarm — no sync, no receipt, no
// first-visit fit — it is provenance alone, for whoever asks whose words a
// route holds (the chat's foreign hold, hive-tree-reader.ts `foreign`).

/** Record a route where a peer's tile was placed. Idempotent; a path already
 *  covered by a carried root above it is a no-op. */
export const markCarriedRoot = (segments: readonly string[]): void => {
  const segs = normalize(segments)
  if (segs.length === 0) return
  const roots = readPaths(CARRIED_KEY)
  if (roots.some(r => isPrefixOf(r, segs))) return
  writePaths(CARRIED_KEY, [...roots, segs])
}

/** Forget carried roots at or beneath `segments` — the tile went (deleted, or
 *  cut, which carries its own mark onward). Ancestors stay. */
export const unmarkCarriedRoot = (segments: readonly string[]): void => {
  const segs = normalize(segments)
  if (segs.length === 0) return
  const roots = readPaths(CARRIED_KEY)
  const kept = roots.filter(r => !isPrefixOf(segs, r))
  if (kept.length !== roots.length) writePaths(CARRIED_KEY, kept)
}

/** WHOSE WORDS A ROUTE HOLDS — true when it lies in a branch folded in from a
 *  peer (an adopted root) or under a peer's tile the participant carried
 *  elsewhere (a carried root). The one question; ask it, never the lists. */
export const isPeerContentAt = (segments: readonly string[]): boolean => {
  if (segments.length === 0) return false
  if (isWithinAdoptedRoot(segments)) return true
  const segs = segments.map(s => String(s ?? ''))
  return readPaths(CARRIED_KEY).some(root => isPrefixOf(root, segs))
}
