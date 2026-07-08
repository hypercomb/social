// diamondcoreprocessor.com/history/child-sig-guard.spec.ts
//
// Regression coverage for the cold-mint preserve guard — the fix for reference
// tiles (and imaged tiles) disappearing when a following paste / cut / move /
// adopt re-lists a parent's children by name and a cold bag auto-mints an empty
// {name} husk over a live child. See child-sig-guard.ts.

import { describe, it, expect } from 'vitest'
import { isBareLayer, chooseChildSig } from './child-sig-guard.js'

const A = 'a'.repeat(64) // a "rich" prior sig (its layer carries slots)
const H = 'b'.repeat(64) // the cold-minted bare {name} husk sig
const E = 'c'.repeat(64) // a legitimately-edited rich sig

describe('isBareLayer', () => {
  it('treats a bare {name} layer as bare (the auto-mint shape)', () => {
    expect(isBareLayer({ name: 'jesse' })).toBe(true)
  })

  it('treats null / undefined / non-object as bare (read-miss prefers prior)', () => {
    expect(isBareLayer(null)).toBe(true)
    expect(isBareLayer(undefined)).toBe(true)
  })

  it('treats empty slots as bare (sparse-layer: absent ≡ empty)', () => {
    expect(isBareLayer({ name: 'x', children: [], decorations: [] })).toBe(true)
  })

  it('is NOT bare when a reference decoration is present', () => {
    expect(isBareLayer({ name: 'jesse', decorations: [A] })).toBe(false)
  })

  it('is NOT bare when it carries properties (an imaged tile)', () => {
    expect(isBareLayer({ name: 'dylan', properties: [A] })).toBe(false)
  })

  it('is NOT bare when it has children', () => {
    expect(isBareLayer({ name: 'people', children: [A] })).toBe(false)
  })
})

describe('chooseChildSig', () => {
  it('mints a genuinely NEW child (no prior sig)', () => {
    expect(chooseChildSig({ resolvedSig: H, resolvedBare: true })).toBe(H)
  })

  it('is a no-op when the resolve matches the prior sig (common warm path)', () => {
    expect(chooseChildSig({ resolvedSig: A, resolvedBare: false, priorSig: A, priorBare: false })).toBe(A)
  })

  // THE BUG: a cold bag resolves a reference tile to a bare {name} husk while
  // the parent still holds the reference's rich sig — the guard must keep the
  // live sig, not the husk.
  it('PRESERVES a live reference sig when the resolve is a cold-mint husk', () => {
    expect(chooseChildSig({ resolvedSig: H, resolvedBare: true, priorSig: A, priorBare: false })).toBe(A)
  })

  it('trusts a legitimate edit (prior moved to a new, non-bare sig)', () => {
    expect(chooseChildSig({ resolvedSig: E, resolvedBare: false, priorSig: A, priorBare: false })).toBe(E)
  })

  it('does NOT resurrect a genuinely emptied child (prior was itself bare)', () => {
    // Both bare and different → no rich content to protect → trust the resolve.
    expect(chooseChildSig({ resolvedSig: H, resolvedBare: true, priorSig: A, priorBare: true })).toBe(H)
  })
})
