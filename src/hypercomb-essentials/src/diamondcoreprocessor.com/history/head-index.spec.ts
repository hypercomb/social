// diamondcoreprocessor.com/history/head-index.spec.ts
//
// Guards the persisted head-index invalidation contract. The index is a
// derived cache whose key (lineageSig) does NOT change when the source
// does — the optimize-phase doctrine's forbidden shape — so safety rests
// on two mechanical rules these tests pin:
//
//   1. Entries carry the marker filename they were derived from, so a
//      restored head can be checked against the bag without byte reads.
//   2. A flush only overwrites entries the session derived/committed and
//      only removes entries it deleted; restored entries pass through
//      untouched. (2026-07-16: a whole-map flush re-persisted a stale
//      restored snapshot and spread a ~100-commit regression to lineages
//      the session never touched.)

import { describe, it, expect } from 'vitest'
import { parseHeadIndex, buildFlushIndex, type HeadIndexFile } from './head-index.js'

const sig = (c: string): string => c.repeat(64)
const LIN_A = sig('a')
const LIN_B = sig('b')
const LIN_C = sig('c')
const HEAD_1 = sig('1')
const HEAD_2 = sig('2')
const HEAD_3 = sig('3')

describe('parseHeadIndex', () => {
  it('parses the stamped { s, m } shape', () => {
    const raw = JSON.stringify({ [LIN_A]: { s: HEAD_1, m: '00000007' } })
    expect(parseHeadIndex(raw)).toEqual({ [LIN_A]: { s: HEAD_1, m: '00000007' } })
  })

  it('parses the legacy plain-string shape as an unstamped entry', () => {
    const raw = JSON.stringify({ [LIN_A]: HEAD_1 })
    expect(parseHeadIndex(raw)).toEqual({ [LIN_A]: { s: HEAD_1 } })
  })

  it('drops a malformed marker stamp but keeps the sig', () => {
    const raw = JSON.stringify({ [LIN_A]: { s: HEAD_1, m: 'not-a-marker' } })
    expect(parseHeadIndex(raw)).toEqual({ [LIN_A]: { s: HEAD_1 } })
  })

  it('drops junk without failing: bad keys, bad sigs, non-objects, corrupt JSON', () => {
    const raw = JSON.stringify({
      'not-a-sig': HEAD_1,
      [LIN_A]: 'not-a-sig-either',
      [LIN_B]: 42,
      [LIN_C]: { s: HEAD_3, m: '00000001' },
    })
    expect(parseHeadIndex(raw)).toEqual({ [LIN_C]: { s: HEAD_3, m: '00000001' } })
    expect(parseHeadIndex('{{{')).toEqual({})
    expect(parseHeadIndex('[1,2]')).toEqual({})
    expect(parseHeadIndex(null)).toEqual({})
  })
})

describe('buildFlushIndex', () => {
  const existing: HeadIndexFile = {
    [LIN_A]: { s: HEAD_1, m: '00000003' },
    [LIN_B]: { s: HEAD_2, m: '00000005' },
  }

  it('overlays only session-owned lineages', () => {
    const heads = new Map([[LIN_A, HEAD_3], [LIN_B, HEAD_3]])
    const stamps = new Map([[LIN_A, '00000009']])
    const out = buildFlushIndex(existing, heads, stamps, new Set([LIN_A]), new Set())
    expect(out[LIN_A]).toEqual({ s: HEAD_3, m: '00000009' })
    // B is in the live map but NOT owned (restored, unvalidated) — the
    // stored entry must pass through byte-identical. This is the exact
    // spreading step of the 2026-07-16 regression.
    expect(out[LIN_B]).toEqual({ s: HEAD_2, m: '00000005' })
  })

  it('never lets a restored-but-unvalidated head overwrite a stored entry', () => {
    // Session restored A (head in memory differs from store — e.g. the
    // store was updated by another tab after this session booted) but
    // never derived it: flush must keep the STORED value.
    const heads = new Map([[LIN_A, HEAD_2]])
    const out = buildFlushIndex(existing, heads, new Map(), new Set(), new Set())
    expect(out).toEqual(existing)
  })

  it('removes session-dropped lineages', () => {
    const out = buildFlushIndex(existing, new Map(), new Map(), new Set(), new Set([LIN_B]))
    expect(out).toEqual({ [LIN_A]: { s: HEAD_1, m: '00000003' } })
  })

  it('a re-set after a drop wins (derive un-drops)', () => {
    // noteHeadDerived removes the lineage from dropped, so a drop
    // followed by re-derivation flushes the new head, not a deletion.
    const heads = new Map([[LIN_B, HEAD_3]])
    const stamps = new Map([[LIN_B, '00000006']])
    const out = buildFlushIndex(existing, heads, stamps, new Set([LIN_B]), new Set())
    expect(out[LIN_B]).toEqual({ s: HEAD_3, m: '00000006' })
  })

  it('skips owned lineages missing from the live map instead of inventing entries', () => {
    const out = buildFlushIndex(existing, new Map(), new Map(), new Set([LIN_C]), new Set())
    expect(out[LIN_C]).toBeUndefined()
    expect(out).toEqual(existing)
  })

  it('persists owned entries without a stamp as unstamped (legacy-validatable)', () => {
    const heads = new Map([[LIN_C, HEAD_3]])
    const out = buildFlushIndex(existing, heads, new Map(), new Set([LIN_C]), new Set())
    expect(out[LIN_C]).toEqual({ s: HEAD_3 })
  })
})
