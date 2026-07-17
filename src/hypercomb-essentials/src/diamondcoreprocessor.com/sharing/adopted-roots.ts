// diamondcoreprocessor.com/sharing/adopted-roots.ts
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
const SEP = ''

const readPaths = (key: string): string[][] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(Array.isArray) : []
  } catch {
    return []
  }
}

const writePaths = (key: string, paths: string[][]): void => {
  try { localStorage.setItem(key, JSON.stringify(paths)) } catch { /* quota — best effort */ }
}

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
