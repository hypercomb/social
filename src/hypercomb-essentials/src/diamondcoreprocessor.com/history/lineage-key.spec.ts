// diamondcoreprocessor.com/history/lineage-key.spec.ts
//
// The canonical lineage-key derivation is the single preimage that both the
// local history sigbag and the mesh channel sig hash. These tests pin the
// convergence contract: names a human reads as "the same place" produce the
// SAME key; names that are genuinely different stay different.

import { describe, it, expect } from 'vitest'
import { canonicalizeLineageSegment, lineageKey, rawLineageKey } from './lineage-key.js'

describe('canonicalizeLineageSegment', () => {
  it('folds separators to a single hyphen (a slug / i18n token)', () => {
    expect(canonicalizeLineageSegment('My Cool Tile')).toBe('My-Cool-Tile')
    expect(canonicalizeLineageSegment('hello.world')).toBe('hello-world')
    expect(canonicalizeLineageSegment('Notes!')).toBe('Notes')
    expect(canonicalizeLineageSegment('My-Cool-Tile')).toBe('My-Cool-Tile') // already a slug → itself
  })

  it('collapses runs of separators and strips edge hyphens', () => {
    expect(canonicalizeLineageSegment('a  -  b')).toBe('a-b')
    expect(canonicalizeLineageSegment('  spaced  ')).toBe('spaced')
    expect(canonicalizeLineageSegment('a___b')).toBe('a-b')
    expect(canonicalizeLineageSegment('(draft)')).toBe('draft') // edge hyphens stripped
  })

  it('unifies invisible variants (en-dash, NBSP, smart quote)', () => {
    expect(canonicalizeLineageSegment('a–b')).toBe(canonicalizeLineageSegment('a-b')) // en-dash == hyphen
    expect(canonicalizeLineageSegment('a b')).toBe(canonicalizeLineageSegment('a b')) // NBSP == space
    expect(canonicalizeLineageSegment('it’s')).toBe(canonicalizeLineageSegment("it's")) // smart quote == straight
  })

  it('preserves digits and letters of any script, and case', () => {
    expect(canonicalizeLineageSegment('Chapter 1')).toBe('Chapter-1')
    expect(canonicalizeLineageSegment('café')).toBe('café')
    expect(canonicalizeLineageSegment('日本語')).toBe('日本語')
    expect(canonicalizeLineageSegment('Hello')).not.toBe(canonicalizeLineageSegment('hello'))
  })

  it('returns empty for a symbol-only name', () => {
    expect(canonicalizeLineageSegment('---')).toBe('')
    expect(canonicalizeLineageSegment('***')).toBe('')
  })
})

describe('lineageKey', () => {
  it('converges punctuation-variant paths onto one key', () => {
    expect(lineageKey(['My-Cool-Tile'])).toBe(lineageKey(['My Cool Tile']))
    expect(lineageKey(['a', 'b-c'])).toBe(lineageKey(['a', 'b c']))
    expect(lineageKey(['a - b'])).toBe(lineageKey(['a-b'])) // run collapse means space-count no longer matters
  })

  it('keeps genuinely-different paths distinct', () => {
    expect(lineageKey(['Chapter 1'])).not.toBe(lineageKey(['Chapter 2']))
    expect(lineageKey(['Hello'])).not.toBe(lineageKey(['hello']))
    expect(lineageKey(['a', 'b'])).not.toBe(lineageKey(['a b'])) // two segments vs one
  })

  it('drops raw-empty segments but keeps symbol-only ones distinct via raw fallback', () => {
    expect(lineageKey(['a', '  ', 'b'])).toBe('a/b') // whitespace-only segment dropped
    expect(lineageKey(['a', '---', 'b'])).toBe('a/---/b') // symbol-only kept as raw
    expect(lineageKey(['---'])).not.toBe(lineageKey([])) // never collapses to the empty ROOT key
  })

  it('the root (no segments) is the empty key', () => {
    expect(lineageKey([])).toBe('')
    expect(lineageKey(['', '   '])).toBe('')
  })

  it('is idempotent — canonical input yields the same key', () => {
    const once = lineageKey(['My-Cool-Tile', 'Section 2'])
    const twice = lineageKey(once.split('/'))
    expect(twice).toBe(once)
  })
})

describe('rawLineageKey (migration bridge)', () => {
  it('reproduces the pre-canonicalization scheme (trim + drop-empty + join)', () => {
    expect(rawLineageKey(['My-Cool-Tile'])).toBe('My-Cool-Tile')
    expect(rawLineageKey(['a', ' b ', ''])).toBe('a/b')
  })

  it('differs from lineageKey only when a name carries a space or non-hyphen punctuation', () => {
    expect(rawLineageKey(['My Cool Tile'])).not.toBe(lineageKey(['My Cool Tile'])) // spaces fold → re-addresses
    expect(rawLineageKey(['Projects'])).toBe(lineageKey(['Projects']))             // clean single word: no migration
    expect(rawLineageKey(['My-Cool-Tile'])).toBe(lineageKey(['My-Cool-Tile']))     // already a slug: no migration
  })
})
