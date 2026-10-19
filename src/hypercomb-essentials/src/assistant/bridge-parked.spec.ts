// bridge-parked.spec.ts — A SESSION IS PARKED ONLY WHILE IT KEEPS VISITING.

import { describe, expect, it } from 'vitest'
import { PARKED_CEILING_MS, PARKED_FLOOR_MS, PARKED_VISITS, ParkedLease, monotonicNow, parkedLeaseMs } from './bridge-parked.js'

describe('how long a visit holds the claim', () => {
  it('is three of the intervals the watcher promised', () => {
    expect(parkedLeaseMs(6_000)).toBe(6_000 * PARKED_VISITS)
  })

  it('never less than the floor, however fast the watcher says it polls', () => {
    expect(parkedLeaseMs(500)).toBe(PARKED_FLOOR_MS)
  })

  it('never more than the ceiling, however slow', () => {
    expect(parkedLeaseMs(10 * 60_000)).toBe(PARKED_CEILING_MS)
  })

  it('is nothing when no readable promise was made', () => {
    for (const said of [undefined, null, 0, -5, NaN, Infinity, '6000', {}, true]) expect(parkedLeaseMs(said)).toBe(0)
  })
})

describe('the claim', () => {
  it('starts unclaimed', () => {
    expect(new ParkedLease().active(1_000)).toBe(false)
  })

  it('is held for the lease and lapses without another visit', () => {
    const lease = new ParkedLease()
    expect(lease.visit(6_000, 1_000)).toBe(true)
    expect(lease.active(1_000 + 17_999)).toBe(true)
    expect(lease.remaining(1_000 + 10_000)).toBe(8_000)
    expect(lease.active(1_000 + 18_000)).toBe(false)
    expect(lease.remaining(1_000 + 18_000)).toBe(0)
  })

  it('survives one missed poll and is renewed by the next visit', () => {
    const lease = new ParkedLease()
    lease.visit(6_000, 0)
    expect(lease.active(12_000)).toBe(true)
    lease.visit(6_000, 12_000)
    expect(lease.active(12_000 + 17_999)).toBe(true)
  })

  it('a visit that promised nothing claims nothing', () => {
    const lease = new ParkedLease()
    expect(lease.visit(undefined, 0)).toBe(false)
    expect(lease.active(1)).toBe(false)
  })

  it('a shorter promise never cuts short a longer claim', () => {
    const lease = new ParkedLease()
    lease.visit(60_000, 0)
    lease.visit(2_000, 5_000)
    expect(lease.active(100_000)).toBe(true)
  })

  it('is read on a clock that never runs backwards', () => {
    const first = monotonicNow()
    expect(monotonicNow()).toBeGreaterThanOrEqual(first)
  })
})
