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

type DriftRow = BatchRow & {
  state: string; live: string | null; here: string | null; versions: readonly { sig: string }[]
  /** The head this hive took into the branch ("Take it", or a card's page on
   *  this origin): its replica receipt (site-replica.ts) says it stands on it. */
  taken?: string | null
  /** This hive's ledger names the live head under ANY key (sealedHere): two
   *  branches that seal alike share one record, kept under the last key. */
  sealedHere?: boolean
}

/** Every head this hive sealed and published under `pubkey`, whatever key its
 *  ledger record names. The ledger keeps one record per sealed signature
 *  (publish-heads.ts writePublishRecord), so when two branches seal to the same
 *  signature only the last one's key is kept: a head is this hive's own when
 *  any record names it, never only when the record's key is the row's. */
export function sealedHere(entries: readonly { sealed: string; record: { pubkey: string } }[], pubkey: string): Set<string> {
  return new Set(entries.filter(entry => entry.record.pubkey === pubkey).map(entry => entry.sealed))
}

const isDrift = (row: DriftRow): boolean =>
  row.state === 'drift' && !!row.live && !!row.here && row.live !== row.here && row.segments.length > 0

/** The head out there is one THIS hive put there (its own publish ledger,
 *  `versions`, names it) or took in (its replica receipt names it). Only then
 *  has the branch here moved on from it. */
const publishedFromHere = (row: DriftRow): boolean =>
  row.sealedHere === true || row.versions.some(v => v.sig === row.live) || (!!row.live && row.taken === row.live)

/** WHAT CHANGED SINCE IT WENT OUT: the rows whose verified index names a head and whose head here has moved on from it —
 *  the Publish panel's `drift` — and nothing else. A row that was never published, one whose host could not be read, and one
 *  that is already live are all left alone: republishing never publishes anything new.
 *  The live head must be one this hive published (its ledger names it). A head another device put there — a card's own
 *  page Publish, carrying what this hive has never seen — is not "behind" here; republishing would push the older card
 *  back over it. Those rows are `driftedElsewhere`, and are never republished in bulk. */
export function driftedRows<T extends DriftRow>(rows: readonly T[]): T[] {
  return rows.filter(row => isDrift(row) && publishedFromHere(row))
}

/** The drifted rows whose live head this hive did not publish — moved on somewhere else, not here. */
export function driftedElsewhere<T extends DriftRow>(rows: readonly T[]): T[] {
  return rows.filter(row => isDrift(row) && !publishedFromHere(row))
}

/** May ONE row be published from here? Always, unless its live head was
 *  published elsewhere: then only when a hand here says so, asked by `confirm`
 *  each time. Take it is the way in; this is the way out when Take it cannot
 *  finish (a part of the card no host serves, a door that reads differently),
 *  so the branch here is never locked out of its own publish. A bulk run never
 *  asks: it leaves such rows out (driftedRows). Never throws. */
export async function mayPublishOver<T extends DriftRow>(row: T, confirm: () => Promise<boolean>): Promise<boolean> {
  if (driftedElsewhere([row]).length === 0) return true
  try { return (await confirm()) === true } catch { return false }
}
