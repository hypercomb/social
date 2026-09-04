// core/format-version.spec.ts
//
// The marker's whole job is one sentence, so the sentences are what is
// pinned. Note the asymmetry it must keep against `directory-safety.ts`: that
// module FAILS CLOSED because its power is to destroy; this one FAILS OPEN
// because its power is only to warn, and a lockout a corrupt byte can trigger
// would be worse than the silence it replaces.

import { describe, expect, it } from 'vitest'
import {
  HIVE_FORMAT_KIND,
  SUPPORTED_FORMAT_VERSION,
  advanceFormat,
  compareFormat,
  parseHiveFormat,
  type HiveFormatDeclaration,
} from './format-version.js'

const CHANGED_AT = Date.UTC(2026, 8, 3)   // 3 September 2026

const declaration = (over: Partial<HiveFormatDeclaration> = {}): HiveFormatDeclaration => ({
  kind: HIVE_FORMAT_KIND,
  v: 1,
  format: 1,
  minReader: 1,
  changedAt: CHANGED_AT,
  ...over,
})

const json = (value: unknown): string => JSON.stringify(value)

describe('SUPPORTED_FORMAT_VERSION', () => {
  it('is still 1 — it moves in the change that first WRITES the new format, never before', () => {
    // Bumping it early makes every existing hive report `ahead-of-hive` and
    // trains the participant to ignore the marker before it has ever said
    // anything true.
    expect(SUPPORTED_FORMAT_VERSION).toBe(1)
  })
})

describe('parseHiveFormat', () => {
  it('reads a well-formed declaration', () => {
    const parsed = parseHiveFormat(json(declaration({ format: 2, minReader: 2, note: 'molecules' })))
    expect(parsed).toEqual({
      kind: HIVE_FORMAT_KIND, v: 1, format: 2, minReader: 2, changedAt: CHANGED_AT, note: 'molecules',
    })
  })

  it('IGNORES unknown extra fields — an older reader must survive a newer record', () => {
    // This is the entire contract. A future field must not make the record
    // unreadable by the clients it exists to warn.
    const parsed = parseHiveFormat(json({ ...declaration({ format: 3, minReader: 3 }), lanes: ['a'], nested: { x: 1 } }))
    expect(parsed?.format).toBe(3)
    expect(parsed?.minReader).toBe(3)
  })

  it('CLAMPS an incoherent minReader rather than rejecting it', () => {
    // A hive cannot require a reader newer than its own format. A typo in a
    // foreign hive's record must not lock this client out of a hive it can
    // demonstrably read.
    expect(parseHiveFormat(json(declaration({ format: 1, minReader: 9 })))?.minReader).toBe(1)
  })

  it('treats anything malformed as NO declaration, never as an error', () => {
    expect(parseHiveFormat(null)).toBeNull()
    expect(parseHiveFormat(undefined)).toBeNull()
    expect(parseHiveFormat('')).toBeNull()
    expect(parseHiveFormat('not json')).toBeNull()
    expect(parseHiveFormat('[]')).toBeNull()
    expect(parseHiveFormat(json({ kind: 'something.else', format: 2, minReader: 2 }))).toBeNull()
    expect(parseHiveFormat(json(declaration({ format: 0 })))).toBeNull()
    expect(parseHiveFormat(json({ ...declaration(), format: '2' }))).toBeNull()
    expect(parseHiveFormat(json({ ...declaration(), format: 1.5 }))).toBeNull()
    expect(parseHiveFormat(json({ ...declaration(), minReader: Infinity }))).toBeNull()
  })

  it('normalises an absent or nonsensical changedAt to 0 rather than inventing one', () => {
    expect(parseHiveFormat(json({ ...declaration(), changedAt: undefined }))?.changedAt).toBe(0)
    expect(parseHiveFormat(json({ ...declaration(), changedAt: -5 }))?.changedAt).toBe(0)
  })
})

describe('compareFormat', () => {
  it('is SILENT and explicit when the hive declares nothing', () => {
    // Every hive that exists today lands here — which is exactly why the
    // marker had to ship before the change it protects against.
    const verdict = compareFormat(null, 1)
    expect(verdict.verdict).toBe('undeclared')
    expect(verdict.announce).toBe(false)
    expect(verdict.sentence).toContain('does not say what format it was written in')
    expect(verdict.sentence).toContain('read as format 1')
  })

  it('is SILENT when the client reads everything', () => {
    const verdict = compareFormat(declaration({ format: 2, minReader: 2 }), 2)
    expect(verdict.verdict).toBe('readable')
    expect(verdict.announce).toBe(false)
    expect(verdict.sentence).toContain('You are seeing everything in it.')
  })

  it('is SILENT when this client is NEWER than the hive — it must never nag', () => {
    // The normal state of the second device on the day it updates first.
    const verdict = compareFormat(declaration({ format: 1, minReader: 1 }), 2)
    expect(verdict.verdict).toBe('ahead-of-hive')
    expect(verdict.announce).toBe(false)
    expect(verdict.sentence).toContain('Nothing is hidden.')
  })

  it('is SILENT for an ADDITIVE format move that kept older readers whole', () => {
    // format 2, minReader 1: the hive moved forward without stranding anyone.
    const verdict = compareFormat(declaration({ format: 2, minReader: 1 }), 1)
    expect(verdict.verdict).toBe('readable')
    expect(verdict.announce).toBe(false)
    expect(verdict.sentence).toContain('kept older clients whole')
  })

  it('ANNOUNCES — and only here — when the hive needs a newer reader', () => {
    const verdict = compareFormat(declaration({ format: 2, minReader: 2 }), 1)
    expect(verdict.verdict).toBe('unreadable')
    expect(verdict.announce).toBe(true)
    expect(verdict.hiveFormat).toBe(2)
    expect(verdict.minReader).toBe(2)
    expect(verdict.clientSupports).toBe(1)
  })

  it('names both numbers, names the DATE, and calls it missing content — not damage', () => {
    const { sentence } = compareFormat(declaration({ format: 2, minReader: 2 }), 1)
    expect(sentence).toContain('format 2')
    expect(sentence).toContain('reads up to format 1')
    expect(sentence).toContain(new Date(CHANGED_AT).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    }))
    expect(sentence).toContain('is not shown here')
    expect(sentence).toContain('Update this client, or open the hive on the device that wrote it.')
    // It must not claim the hive is broken, and must not offer to fix it.
    expect(sentence).not.toMatch(/corrupt|broken|damaged|repair/i)
  })

  it('drops the date clause rather than rendering an epoch when the record does not say', () => {
    const { sentence } = compareFormat(declaration({ format: 2, minReader: 2, changedAt: 0 }), 1)
    expect(sentence).toContain('anything added since is not shown here')
    expect(sentence).not.toContain('1970')
  })

  it('defaults to what this client supports when no client version is given', () => {
    expect(compareFormat(null).clientSupports).toBe(SUPPORTED_FORMAT_VERSION)
    expect(compareFormat(null, 0 as unknown as number).clientSupports).toBe(SUPPORTED_FORMAT_VERSION)
  })

  it('is pure — the same inputs give the same verdict, and it reads no clock', () => {
    const a = compareFormat(declaration({ format: 2, minReader: 2 }), 1)
    const b = compareFormat(declaration({ format: 2, minReader: 2 }), 1)
    expect(a).toEqual(b)
  })
})

describe('advanceFormat — a downgrade is uncomposable, not merely discouraged', () => {
  it('accepts the first declaration a hive ever makes', () => {
    expect(advanceFormat(null, declaration({ format: 1, minReader: 1 }))?.format).toBe(1)
  })

  it('accepts a genuine advance', () => {
    expect(advanceFormat(declaration({ format: 1, minReader: 1 }), declaration({ format: 2, minReader: 2 }))?.format).toBe(2)
    // minReader alone may move, when a format stops being backward-readable.
    expect(advanceFormat(declaration({ format: 2, minReader: 1 }), declaration({ format: 2, minReader: 2 }))?.minReader).toBe(2)
  })

  it('REFUSES an older declaration arriving after a newer one', () => {
    // The scenario: two devices, the newer one declared format 2, the older
    // one then boots and would otherwise write format 1 back — turning the
    // warning OFF on every client, because putPoolDoc is last-write-wins.
    expect(advanceFormat(declaration({ format: 2, minReader: 2 }), declaration({ format: 1, minReader: 1 }))).toBeNull()
    expect(advanceFormat(declaration({ format: 2, minReader: 2 }), declaration({ format: 2, minReader: 1 }))).toBeNull()
  })

  it('REFUSES a no-op, so a re-run writes nothing', () => {
    expect(advanceFormat(declaration({ format: 2, minReader: 2 }), declaration({ format: 2, minReader: 2 }))).toBeNull()
  })

  it('is idempotent across repeated declarations', () => {
    let current: HiveFormatDeclaration | null = null
    const proposed = declaration({ format: 2, minReader: 2 })
    for (let i = 0; i < 5; i++) current = advanceFormat(current, proposed) ?? current
    expect(current).toEqual(proposed)
  })
})
