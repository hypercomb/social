// core/format-version.attack.spec.ts
//
// ADVERSARIAL PASS over the hive format marker. The marker's ENTIRE product
// is one sentence a human can act on, so every test here attacks the
// sentence: is it still TRUE when the record is corrupt, empty, from the
// future, or written by a schema this client has never seen?
//
// These are written to FAIL against the current implementation. Each one
// names the exact input that produces the bad sentence.

import { describe, expect, it } from 'vitest'
import {
  HIVE_FORMAT_KIND,
  compareFormat,
  parseHiveFormat,
  type HiveFormatDeclaration,
} from './format-version.js'

const declaration = (over: Partial<HiveFormatDeclaration> = {}): HiveFormatDeclaration => ({
  kind: HIVE_FORMAT_KIND,
  v: 1,
  format: 2,
  minReader: 2,
  changedAt: Date.UTC(2026, 8, 3),
  ...over,
})

describe('ATTACK — a changedAt outside the Date range leaks "Invalid Date" into the sentence', () => {
  // `positiveInteger` guards `format` and `minReader` with isSafeInteger, but
  // `changedAt` is guarded only by `typeof number && isFinite && > 0`. Every
  // value below survives that check, and `whenClause`'s try/catch never fires
  // because `toLocaleDateString` on an invalid Date RETURNS "Invalid Date"
  // rather than throwing.
  for (const [label, changedAt] of [
    ['one millisecond past the Date range', 8.64e15 + 1],
    ['a float overflow', 1e300],
    ['Number.MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
  ] as const) {
    it(`does not print "Invalid Date" for ${label}`, () => {
      const { sentence, announce } = compareFormat(declaration({ changedAt }), 1)
      expect(announce).toBe(true)   // this IS the announcing verdict
      expect(sentence).not.toContain('Invalid Date')
    })
  }
})

describe('ATTACK — a marker from the future asserts a cutoff that has not happened', () => {
  it('does not tell the participant content is missing since a future date', () => {
    // A clock-skewed or hand-edited writer stamps 2099. The sentence then
    // reads "anything added since December 30, 2099 is not shown here",
    // which is not a true statement about anything.
    const changedAt = Date.UTC(2099, 11, 31)
    const { sentence } = compareFormat(declaration({ changedAt }), 1)
    const rendered = new Date(changedAt).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    })
    expect(sentence).not.toContain(rendered)
  })
})

describe('ATTACK — a CORRUPT declaration is indistinguishable from NO declaration', () => {
  // parseHiveFormat collapses "there is no record" and "there is a record I
  // cannot read" into the same `null`, and compareFormat then asserts a CAUSE
  // it cannot know: "It was made before format tracking". For a hive that
  // demonstrably HAS a marker — one written by a newer schema, or a truncated
  // write — that sentence is false, and it is false in the reassuring
  // direction.
  const corrupt = [
    '{"kind":"hypercomb.hive-format","format":"2","minReader":"2"}',     // future schema: numbers as strings
    '{"kind":"hypercomb.hive-format","version":{"format":2,"min":2}}',   // future schema: nested
    '{"kind":"hypercomb.hive-format","format":2,"minReader":2',          // truncated write
  ]

  it('every corrupt record parses to the same null as a missing one', () => {
    for (const text of corrupt) expect(parseHiveFormat(text)).toBeNull()
    expect(parseHiveFormat(null)).toBeNull()
  })

  it('the sentence must not claim the hive predates format tracking when a marker exists', () => {
    const { sentence } = compareFormat(parseHiveFormat(corrupt[0]), 1)
    expect(sentence).not.toContain('made before format tracking')
  })
})
