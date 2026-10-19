// assistant/bridge-parked.ts
//
// IS A SESSION PARKED ON THE BRIDGE? The broker being up says nothing about it:
// the managers ride the broker all day, with no session answering anything, so
// "the bridge is connected" was read by the chat window as "somebody will take
// this question" — and a question the models declined waited for good in a
// queue nothing drained ("waiting for reply…", jwize, 2026-10-12 / 10-15).
//
// What proves a session is parked is the session itself: the parked watcher
// (scripts/bridge/watch-asks.cjs) visits the ask pool on a timer, and each
// visit says how often it will return. A visit holds the claim for three of
// those intervals — one missed poll is churn, three are gone — and a session
// that stops visiting stops being parked without anybody having to say so.
// A one-off peek (`loop-run`, `drain-tick`, a smoke `--once`) says nothing
// about returning, so it claims nothing.

/** Visits a claim survives: the watcher can miss one and still be parked. */
export const PARKED_VISITS = 3
/** The shortest a claim lasts, however fast the watcher says it polls. */
export const PARKED_FLOOR_MS = 10_000
/** The longest, however slow: a claim older than this is a session long gone. */
export const PARKED_CEILING_MS = 120_000

/** How long a visit that promised to return every `everyMs` holds the claim;
 *  0 when it promised nothing readable. Pure. */
export const parkedLeaseMs = (everyMs: unknown): number => {
  const every = typeof everyMs === 'number' ? everyMs : NaN
  if (!Number.isFinite(every) || every <= 0) return 0
  return Math.min(PARKED_CEILING_MS, Math.max(PARKED_FLOOR_MS, every * PARKED_VISITS))
}

/** The clock a lease is read on. A claim is a stretch of time, never a date, so
 *  it must not move when the wall clock is set back (a synced clock, a manual
 *  change): that would keep a dead session parked until the clock caught up. */
export const monotonicNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()

/** The claim itself. Time is always handed in, so it is exact under a test and
 *  never depends on a timer having fired in a throttled background tab. */
export class ParkedLease {
  #until = 0

  /** A visit arrived. True when it counted. The longest claim stands: one
   *  watcher's visit never cuts short another's. */
  visit(everyMs: unknown, now: number): boolean {
    const lease = parkedLeaseMs(everyMs)
    if (!lease) return false
    this.#until = Math.max(this.#until, now + lease)
    return true
  }

  /** Is somebody parked at this moment? */
  active(now: number): boolean { return now < this.#until }

  /** Ms until the claim lapses without another visit; 0 when it already has. */
  remaining(now: number): number { return Math.max(0, this.#until - now) }
}
