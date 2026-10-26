// sharing/publish-batch.ts
//
// PUBLISH THE SELECTED (jwize 2026-10-24: "selectable to publish changes only
// on selected"). The Publish panel names the branches; the drone runs them —
// ONE AT A TIME, never side by side: every publish re-signs the host's whole
// index, and two at once can drop a stage-list member (publish-groups.drone
// runs its members the same way). This is the order.

export interface BatchRow {
  key: string
  path: string
  segments: readonly string[]
}

/** The rows to publish, in the order to publish them: each named key once,
 *  only rows this hive can seal (a row from another device has no path here),
 *  DEEPEST FIRST — an ancestor's seal covers its subtree, and a child's publish
 *  writes its own lights, so the ancestor goes last and is not left drifting
 *  behind a child published after it. Ties by path. */
export function batchOrder<T extends BatchRow>(rows: readonly T[], keys: readonly string[]): T[] {
  const wanted = new Set(keys.map(String))
  return rows
    .filter(row => wanted.has(row.key) && row.segments.length > 0)
    .sort((a, b) => b.segments.length - a.segments.length || a.path.localeCompare(b.path))
}

/** WHAT CHANGED SINCE IT WENT OUT: the rows whose verified index names a head and whose head here has moved on from it —
 *  the Publish panel's `drift` — and nothing else. A row that was never published, one whose host could not be read, and one
 *  that is already live are all left alone: republishing never publishes anything new. */
export function driftedRows<T extends BatchRow & { state: string; live: string | null; here: string | null }>(rows: readonly T[]): T[] {
  return rows.filter(row => row.state === 'drift' && !!row.live && !!row.here && row.live !== row.here && row.segments.length > 0)
}
