// A reference decoration is content-addressed and `appliesTo: []`, so its
// PAYLOAD BYTES are its identity. Everything here defends that: the same
// content written by any of the three writers has to serialize identically or
// references silently stop deduplicating, and an emptied requirement has to be
// byte-identical to a reference that never carried one.
//
// These are cheap tests guarding an expensive, SILENT failure — a dedup break
// costs a duplicated record per reference and shows no symptom at all.

import { describe, it, expect, vi } from 'vitest'

// The behaviour (and the decoration index it imports) self-register into
// `window.ioc` at import time, so the shell global must exist before the module
// is evaluated. Nothing here calls into the shell — these cases exercise the
// pure payload builder.
vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
  }
})

import { buildReferencePayload, normalizeRequiredMarks } from './requires.queen.js'

const SIG = 'a'.repeat(64)

describe('required marks — normalization', () => {
  it('sorts, dedups and drops blanks so order of typing cannot fork the sig', () => {
    expect(normalizeRequiredMarks(['work', 'family', 'work', '  ', 'close']))
      .toEqual(['close', 'family', 'work'])
    // The property that matters: any permutation lands on one answer.
    expect(normalizeRequiredMarks(['family', 'work']))
      .toEqual(normalizeRequiredMarks(['work', 'family']))
  })

  it('treats an emptied demand as no demand', () => {
    expect(normalizeRequiredMarks([])).toEqual([])
    expect(normalizeRequiredMarks(['', '   '])).toEqual([])
  })
})

describe('reference payload — the bytes are the identity', () => {
  it('omits requiredMarks entirely when nothing is demanded', () => {
    // Not `requiredMarks: []`. An empty array is different bytes, so a
    // reference whose requirement was cleared would never again dedup with a
    // plain reference to the same place.
    const cleared = buildReferencePayload({
      targetSegments: ['people'], targetSig: SIG, requiredMarks: [],
    })
    const plain = buildReferencePayload({ targetSegments: ['people'], targetSig: SIG })

    expect('requiredMarks' in cleared).toBe(false)
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(plain))
  })

  it('serializes identically regardless of the order the marks arrived in', () => {
    const a = buildReferencePayload({
      targetSegments: ['people'], targetSig: SIG, requiredMarks: ['work', 'family'],
    })
    const b = buildReferencePayload({
      targetSegments: ['people'], targetSig: SIG, requiredMarks: ['family', 'work'],
    })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('keeps differing demands DIFFERENT — that is what many-refs-one-target needs', () => {
    const family = buildReferencePayload({
      targetSegments: ['people'], targetSig: SIG, requiredMarks: ['family'],
    })
    const work = buildReferencePayload({
      targetSegments: ['people'], targetSig: SIG, requiredMarks: ['work'],
    })
    expect(JSON.stringify(family)).not.toBe(JSON.stringify(work))
  })

  it('holds the field order /reference writes, so the two writers agree', () => {
    // `/reference` writes `{ targetSegments, targetSig }` in that order. JSON
    // preserves insertion order, so a builder that emitted them the other way
    // round would mint a different sig for identical content.
    expect(Object.keys(buildReferencePayload({
      targetSegments: ['a'], targetSig: SIG, requiredMarks: ['m'],
    }))).toEqual(['targetSegments', 'targetSig', 'requiredMarks'])
    expect(JSON.stringify(buildReferencePayload({ targetSegments: ['a'], targetSig: SIG })))
      .toBe(JSON.stringify({ targetSegments: ['a'], targetSig: SIG }))
  })

  it('drops a targetSig that is not a signature rather than carrying it', () => {
    const payload = buildReferencePayload({ targetSegments: ['a'], targetSig: 'not-a-sig' })
    expect('targetSig' in payload).toBe(false)
  })
})
