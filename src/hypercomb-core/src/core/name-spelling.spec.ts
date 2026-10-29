// The name a human types and an AI emits, and the ref a rename leaves behind.
import { describe, expect, it } from 'vitest'
import { standardName } from './lineage-key.js'
import {
  BARE_WORD_POOL_MEANINGS, SCOPED_POOL_MEANINGS,
  canonicalPoolMeaning, obsoletePoolSpellings, spellPoolMeaning,
} from './pool-registry.js'

describe('standardName', () => {
  it('keeps letters and digits, and turns every other run into one hyphen', () => {
    expect(standardName('My Tile')).toBe('my-tile')
    expect(standardName('Hello, World!')).toBe('hello-world')
    expect(standardName('a--b')).toBe('a-b')
    expect(standardName('a  -  b')).toBe('a-b')
    expect(standardName('Chapter 1')).toBe('chapter-1')
    expect(standardName('café')).toBe('café')
    expect(standardName('日本語')).toBe('日本語')
    expect(standardName('--')).toBe('')
  })

  it('is idempotent, so a name that is already standard survives a second pass', () => {
    for (const name of ['my-tile', 'chapter-1', '日本語', 'games']) {
      expect(standardName(standardName(name))).toBe(standardName(name))
    }
  })
})

describe('spellPoolMeaning', () => {
  it('leaves every live pool meaning where it is', () => {
    for (const meaning of [...BARE_WORD_POOL_MEANINGS, ...SCOPED_POOL_MEANINGS]) {
      expect(spellPoolMeaning(meaning), meaning).toBe(meaning)
      expect(canonicalPoolMeaning(meaning), meaning).toBe(meaning)
    }
  })

  it('folds punctuation into one hyphen, and keeps one system colon', () => {
    expect(spellPoolMeaning('cigar:brand')).toBe('cigar-brand')
    expect(spellPoolMeaning('business/people')).toBe('business-people')
    expect(spellPoolMeaning('games:solomon:talk')).toBe('games:solomon-talk')
    expect(spellPoolMeaning('Games:Solomon:Talk')).toBe('games:solomon-talk')
    expect(spellPoolMeaning('system:clipboard')).toBe('system:clipboard')
  })

  it('keeps a facet — a word, one colon, a signature', () => {
    const sig = 'ab'.repeat(32)
    expect(spellPoolMeaning(`Members:${sig}`)).toBe(`members:${sig}`)
  })

  it('a rename ref answers with the current name and still names the obsolete spelling', () => {
    expect(canonicalPoolMeaning('games:solomon:talk')).toBe('games:solomon-talk')
    expect(canonicalPoolMeaning('games:solomon-talk')).toBe('games:solomon-talk')
    expect(obsoletePoolSpellings('games:solomon-talk')).toContain('games:solomon:talk')
    expect(obsoletePoolSpellings('games:solomon:talk')).toEqual(
      obsoletePoolSpellings('games:solomon-talk'),
    )
  })
})
