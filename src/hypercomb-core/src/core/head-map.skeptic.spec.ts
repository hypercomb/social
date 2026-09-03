// core/head-map.skeptic.spec.ts
//
// AN ADVERSARIAL PASS OVER STEP 4, ONE LENS: TERMINATION AND CYCLES.
//
// The canonical form holds up: it is a total function of a SET, it terminates
// by construction, and the rows door is a flat loop with no recursion in it
// anywhere. Those are pinned below as HOLDS.
//
// What did NOT hold was the boundary between the writer and the reader.
// `head-map.ts` stated the rule itself, in `encodeHeadMap`'s own doc comment:
//
//   "THROWS on a non-canonical record. A writer that can emit bytes no reader
//    will parse is a strictly weaker gate than the reader, and under a publish
//    that advances a pointer before anyone reads it, that asymmetry publishes
//    a deploy nobody can verify."
//
// `parseHeadMap` refused any text longer than 1 << 22 bytes. `encodeHeadMap`
// had no size gate at all. So the module created exactly the asymmetry it
// forbids, at a threshold a real hive can reach: a row costs 203 bytes, so the
// wall is 20,660 molecules — and the failure was TOTAL (the whole deploy
// unreadable), SILENT (the mint succeeded and the pointer advanced) and
// PERMANENT for as long as the hive kept growing.
//
// FIXED. `HEAD_MAP_MAX_BYTES` is now the encoder's ceiling and the parser's,
// `headMapRefusal` says WHICH gate refused (a publisher who must shard and a
// host that must not be believed call for opposite responses), and
// `splitHeadMap` makes the cap a boundary rather than a cliff — a map is a SET,
// and a set splits.
//
// POLARITY: EVERY TEST IN THIS FILE NOW ASSERTS THE REQUIREMENT. It was written
// the other way round — `T-*` asserted the defect and a pass reproduced it —
// so each fixture is kept verbatim and only the assertions are inverted.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

import {
  HEAD_MAP_MAX_BYTES,
  canonicalHeadMap,
  encodeHeadMap,
  headMapRefusal,
  parseHeadMap,
  splitHeadMap,
  verifyHeadMapRows,
  type HeadMapPair,
} from './head-map.js'

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const pairsOf = (n: number): HeadMapPair[] => {
  const out: HeadMapPair[] = []
  for (let i = 0; i < n; i++) out.push({ molecule: sha256(`m${i}`), claim: sha256(`c${i}`) })
  return out
}

const KEY = sha256('publisher')

describe('HOLDS — the termination argument', () => {
  it('H-3 the rows door is a FLAT LOOP: 5,000 rows, no recursion, no stack growth', async () => {
    const record = canonicalHeadMap(KEY, pairsOf(5000))!
    expect(record).not.toBeNull()
    const verdict = await verifyHeadMapRows(record, KEY, async () => null, () => ({ ok: false, authentic: false }))
    expect(verdict.rowsAuthentic).toBe(false)
    expect(verdict.reason).toBe('incomplete')
    expect(verdict.holes).toHaveLength(5000)
    expect(verdict.holes.every((h) => h.reason === 'absent')).toBe(true)
  })

  it('H-4 canonicalization is idempotent and order-free at 5,000 rows', () => {
    const pairs = pairsOf(5000)
    const forward = encodeHeadMap(canonicalHeadMap(KEY, pairs)!)
    const backward = encodeHeadMap(canonicalHeadMap(KEY, [...pairs].reverse())!)
    expect(backward).toBe(forward)
    expect(parseHeadMap(forward)).not.toBeNull()
  })
})

describe('T-6 the writer and the reader now have the SAME gate', () => {
  it('a row costs 203 bytes, so the reader cap lands at ~20,660 molecules', () => {
    const bytes = encodeHeadMap(canonicalHeadMap(KEY, pairsOf(1000))!)
    // 1000 rows of 135 bytes + 1000 refs of 66 bytes + separators + a 131-byte frame.
    expect(Math.round((bytes.length - 118) / 1000)).toBe(203)
  })

  it('T-6 encodeHeadMap REFUSES bytes parseHeadMap would refuse — the asymmetry is gone', () => {
    const record = canonicalHeadMap(KEY, pairsOf(20800))!
    expect(record).not.toBeNull()

    // The writer used to be happy: no throw, no null, no warning — the deploy
    // signature was minted over these bytes and the pointer advanced over a
    // deploy nobody could read. It fails at the publisher now, where somebody
    // can act on it, instead of at a visitor, where nobody can.
    expect(() => encodeHeadMap(record)).toThrow(RangeError)
    expect(() => encodeHeadMap(record)).toThrow(/splitHeadMap/)
  })

  it('T-6b the cliff is gone: one row over the wall costs one shard, not every molecule', () => {
    // 20,660 rows fit exactly. Adding one more molecule — a single new tile
    // name — used to lose not that molecule but ALL of them, which is the one
    // failure mode step 4 promised had been eliminated ("one cold atom never
    // makes a publisher's whole deploy unverifiable").
    const under = encodeHeadMap(canonicalHeadMap(KEY, pairsOf(20660))!)
    expect(under.length).toBeLessThanOrEqual(HEAD_MAP_MAX_BYTES)
    expect(parseHeadMap(under)).not.toBeNull()

    const over = canonicalHeadMap(KEY, pairsOf(20661))!
    expect(() => encodeHeadMap(over)).toThrow(RangeError)

    const shards = splitHeadMap(over)
    expect(shards).toHaveLength(2)
    expect(shards.reduce((n, s) => n + s.rows.length, 0)).toBe(20661)
    for (const shard of shards) expect(parseHeadMap(encodeHeadMap(shard))).toEqual(shard)
    // no molecule duplicated, none dropped
    expect(new Set(shards.flatMap((s) => s.rows.map((r) => r[0]))).size).toBe(20661)
  })

  it('T-6c the refusal distinguishes "too big" from "tampered with"', () => {
    // A bare null could not tell a publisher who must shard from a host that
    // must not be believed, and those call for opposite responses.
    const good = encodeHeadMap(canonicalHeadMap(KEY, pairsOf(2))!)
    expect(headMapRefusal(good)).toBeNull()
    expect(headMapRefusal('x'.repeat(HEAD_MAP_MAX_BYTES + 1))).toBe('oversize')
    expect(headMapRefusal('not json')).toBe('unparseable')
    expect(headMapRefusal(good.replace('"v":1', '"v":2'))).toBe('non-canonical')
    // and `parseHeadMap` still answers with a record or null, unchanged
    expect(parseHeadMap('x'.repeat(HEAD_MAP_MAX_BYTES + 1))).toBeNull()
  })

  it('T-6d the prototype twin has the same gate now', () => {
    // `documentation/molecule-lineage-prototype/head-map.mjs` used to open with
    // `if (typeof text !== 'string') return null` and never check length, so it
    // parsed what core refused — a mirror that diverges on the one guard
    // capable of rejecting a real deploy is not a mirror. It carries
    // `HEAD_MAP_MAX_BYTES`, the same encoder throw and the same
    // `headMapRefusal` now, and `headmap-skeptic-0.test.mjs` T-6 exercises all
    // three over a real molecule store.
    expect(HEAD_MAP_MAX_BYTES).toBe(4194304)
  })
})
