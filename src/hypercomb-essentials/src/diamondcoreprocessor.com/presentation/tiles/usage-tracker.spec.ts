// hypercomb-shared/core/usage-tracker.spec.ts
//
// The counting must survive being interrupted. Interactions are what order the
// preload — the tiles a participant actually opens get their insides warmed
// first, so they brighten out of the readiness shade first — and the pool doc
// they end up in is written debounced and async. Everything between the click
// and that write is a window where a crash, a kill, or a reload could eat the
// count. The write-ahead queue is what closes it: increment locally first,
// subtract only what a successful write actually carried.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Self-registers in IoC at module load via the `register` global the shell
// installs. Stub it so the module imports standalone.
;(globalThis as { register?: unknown }).register = (): void => {}

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const PENDING_KEY = 'hc:usage-pending'

type Tracker = {
  bump(sig: string, n?: number): void
  weight(sig: string): number
  interactions(sig: string): number
  rank(sigs: readonly string[]): string[]
}

/** A fresh tracker with no IoC deps resolved — nothing to load from, nothing
 *  to flush to, so the queue is the only thing holding the counts. */
const freshTracker = async (): Promise<Tracker> => {
  vi.resetModules()
  ;(globalThis as { ioc?: unknown }).ioc = undefined
  const mod = await import('./usage-tracker.js')
  return new mod.UsageTracker() as unknown as Tracker
}

describe('UsageTracker interactions', () => {
  beforeEach(() => localStorage.clear())

  it('counts an interaction per tile and ranks the most-met tile first', async () => {
    const tracker = await freshTracker()
    tracker.bump(SIG_B)
    tracker.bump(SIG_A)
    tracker.bump(SIG_A)

    expect(tracker.interactions(SIG_A)).toBe(2)
    expect(tracker.interactions(SIG_B)).toBe(1)
    expect(tracker.weight(SIG_A)).toBeGreaterThan(tracker.weight(SIG_B))
    expect(tracker.rank([SIG_B, SIG_A])).toEqual([SIG_A, SIG_B])
  })

  it('ignores non-signatures and non-positive counts', async () => {
    const tracker = await freshTracker()
    tracker.bump('not-a-signature')
    tracker.bump(SIG_A, 0)
    expect(tracker.interactions(SIG_A)).toBe(0)
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it('queues every increment write-ahead, before any pool write', async () => {
    const tracker = await freshTracker()
    tracker.bump(SIG_A)
    const queued = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}')
    expect(queued[SIG_A]?.c).toBe(1)
  })

  it('recovers un-flushed counts after a crash — a new tracker reads the queue back', async () => {
    const before = await freshTracker()
    before.bump(SIG_A, 3)
    expect(before.interactions(SIG_A)).toBe(3)

    // Crash: the pool write never happened, the instance is gone.
    const after = await freshTracker()
    expect(after.interactions(SIG_A)).toBe(3)
    // Still queued — it leaves only when a write confirms it.
    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}')[SIG_A]?.c).toBe(3)
  })

  it('keeps recovered counts distinct from new ones and keeps accumulating', async () => {
    const before = await freshTracker()
    before.bump(SIG_A)

    const after = await freshTracker()
    after.bump(SIG_A)
    expect(after.interactions(SIG_A)).toBe(2)
    expect(JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}')[SIG_A]?.c).toBe(2)
  })
})
