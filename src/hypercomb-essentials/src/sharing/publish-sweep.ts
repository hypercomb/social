// publish-sweep.ts — how the Publish window's look walks its rows.
//
// A row's check is a handful of reads (its plan, its promotion, a probe of
// its live head, its entrances' scents) and one local walk: sealing what is
// here. The reads are network questions that each take their own deadline;
// the walk is the only expensive local step, and after a commit it re-walks
// live heads across the branch, so N of them at once is how a status panel
// stalls the hive. The look used to do ALL of it one row at a time and one
// step at a time, so a single slow answer held every row behind it: twenty
// rows behind a starved probe never finished (2026-11-16).
//
// Now a few rows are checked at once and each row asks its reads together,
// while every seal still waits its turn in one lane.

import { mapBounded } from './bounded-fetch.js'

/** How many rows are checked at once. */
export const ROWS_AT_ONCE = 4

/** Runs `work` after every seal handed to this lane before it. */
export type SealLane = <R>(work: () => Promise<R>) => Promise<R>

/** One lane: whatever is handed to it runs alone, in the order handed. */
export const sealLane = (): SealLane => {
  let tail: Promise<unknown> = Promise.resolve()
  return <R>(work: () => Promise<R>): Promise<R> => {
    const run = tail.then(work, work)
    tail = run.catch(() => undefined)
    return run
  }
}

/** Check every row, `limit` at a time, in the order given; sealing goes
 *  through one shared lane. A row whose check throws is left as it was. */
export async function sweepRows<T>(
  rows: readonly T[],
  check: (row: T, seal: SealLane) => Promise<void>,
  limit = ROWS_AT_ONCE,
): Promise<void> {
  const seal = sealLane()
  await mapBounded(rows, limit, row => check(row, seal).catch(() => undefined))
}
