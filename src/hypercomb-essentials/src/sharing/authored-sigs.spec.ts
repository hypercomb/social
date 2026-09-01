// authored-sigs.spec.ts — the participant-local authored allow-set.
// Pool mirroring is fire-and-forget via globalThis.ioc (absent in jsdom →
// silently skipped), so these cover the sync localStorage semantics the
// verification gate reads.

import { beforeEach, describe, expect, it } from 'vitest'
import { authoredSigs, isAuthored, markAuthored, markLayerAuthoredPageSigs, markManyAuthored } from './authored-sigs.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)

beforeEach(() => localStorage.clear())

describe('authored-sigs', () => {
  it('marks and reads back a valid sig', () => {
    markAuthored(SIG_A)
    expect(isAuthored(SIG_A)).toBe(true)
    expect(isAuthored(SIG_B)).toBe(false)
  })

  it('normalizes case and whitespace', () => {
    markAuthored(`  ${SIG_A.toUpperCase()}  `)
    expect(isAuthored(SIG_A)).toBe(true)
  })

  it('rejects non-sig inputs', () => {
    markAuthored('not-a-sig')
    markAuthored('')
    markAuthored(null)
    markAuthored(42)
    markAuthored(SIG_A.slice(0, 63))
    expect(authoredSigs().size).toBe(0)
  })

  it('is idempotent', () => {
    markAuthored(SIG_A)
    markAuthored(SIG_A)
    markManyAuthored([SIG_A, SIG_A])
    expect(authoredSigs().size).toBe(1)
  })

  it('markManyAuthored records only valid sigs', () => {
    markManyAuthored([SIG_A, 'junk', SIG_B, undefined])
    expect(isAuthored(SIG_A)).toBe(true)
    expect(isAuthored(SIG_B)).toBe(true)
    expect(authoredSigs().size).toBe(2)
  })

  it('markLayerAuthoredPageSigs picks the website and context slots only', () => {
    markLayerAuthoredPageSigs({
      name: 'cell',
      website: [SIG_A],
      context: [SIG_B, 'junk'],
      decorations: [SIG_C],   // decoration path records its htmlSig separately
      children: [SIG_C],
    })
    expect(isAuthored(SIG_A)).toBe(true)
    expect(isAuthored(SIG_B)).toBe(true)
    expect(isAuthored(SIG_C)).toBe(false)
  })

  it('tolerates malformed storage', () => {
    localStorage.setItem('hc:authored-sigs', '{nope')
    expect(isAuthored(SIG_A)).toBe(false)
    markAuthored(SIG_A)
    expect(isAuthored(SIG_A)).toBe(true)
  })
})
