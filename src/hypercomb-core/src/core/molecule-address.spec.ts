// core/molecule-address.spec.ts
//
// THE COLON PROOF, and the rest of the address syntax made executable.
//
// The entire reservation that keeps system pools safe rests on ONE theorem:
// `canonicalizeLineageSegment` can never emit a colon, in any script. These
// tests assert the STRONGEST form of it — canon's output alphabet is letters,
// digits and hyphens and nothing else — so the theorem holds for characters
// nobody thought to enumerate.
//
// Every address assertion is RELATIONAL (address === address, address !==
// address). No 64-hex literal appears here: pool addresses are DERIVED, and a
// spec that pins one would be pinning a hash rather than a rule.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BARE_WORD_POOL_MEANINGS, SCOPED_POOL_MEANINGS, registerPoolMeaning, reservedColonScopes,
} from './pool-registry.js'
import { canonicalizeLineageSegment } from './lineage-key.js'
import {
  CANON_ALPHABET, facetAddress, facetPreimage, fold, moleculeAddress, moleculeKey,
  moleculeWordOf, rootMoleculeAddress, validatePoolSpelling,
} from './molecule-address.js'

const SIG = 'a'.repeat(64)

/** Every character class that has ever been proposed as a way to sneak a colon
 *  through canonicalization, plus a spread of scripts. */
const ADVERSARIAL = [
  'websites:menu',
  'a::b',
  ':leading',
  'trailing:',
  'full：width',        // FULLWIDTH COLON
  'ratio∶colon',       // RATIO
  'modifier꞉letter',   // MODIFIER LETTER COLON
  'triangularːcolon',  // TRIANGULAR COLON (IPA length mark)
  'rtl‏mark',
  'combininǵaccent',
  'Живот',   // Cyrillic
  'مرحبا',   // Arabic
  '日本語',               // Han
  '\u{1F600}\u{1F955}',               // emoji
  'Chapter 1',
  'a - b',
  '  spaced  ',
  '(draft)',
  'Ⓐ',                 // CIRCLED LATIN CAPITAL LETTER A — canon returns ''
]

describe('canon can never emit a colon', () => {

  it('emits ONLY letters, digits and hyphens — in any script', () => {
    const corpus = [...BARE_WORD_POOL_MEANINGS, ...SCOPED_POOL_MEANINGS, ...ADVERSARIAL]
    for (const input of corpus) {
      const canon = canonicalizeLineageSegment(input)
      expect(CANON_ALPHABET.test(canon), `canon(${JSON.stringify(input)}) = ${JSON.stringify(canon)}`).toBe(true)
      expect(canon.includes(':'), `canon(${JSON.stringify(input)}) leaked a colon`).toBe(false)
    }
  })

  it('folds the documented worked example', () => {
    expect(canonicalizeLineageSegment('websites:menu')).toBe('websites-menu')
  })

  it('no tile name in any script reaches a colon-scoped system pool', async () => {
    for (const meaning of SCOPED_POOL_MEANINGS) {
      const system = await registerPoolMeaning(meaning)
      const molecule = await moleculeAddress(meaning)
      expect(molecule, `a tile named ${JSON.stringify(meaning)} landed on its system pool`).not.toBe(system)
    }
  })

  it('the two preimage functions are different functions, asserted against the live registry', async () => {
    // A BARE-WORD meaning DOES collide — that coincidence is the design, and
    // the reason the bare-word list may only shrink. Asserting it here keeps
    // the collision visible rather than surprising.
    const bare = BARE_WORD_POOL_MEANINGS[0]
    expect(await moleculeAddress(bare)).toBe(await registerPoolMeaning(bare))
  })
})

describe('fold', () => {

  it('is locale-INDEPENDENT — the module never names toLocaleLowerCase', () => {
    // Comments STRIPPED — the module's own header names the trap it avoids,
    // and a ratchet that a warning can trip is a ratchet nobody keeps.
    const code = readFileSync(join(__dirname, 'molecule-address.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    expect(code.includes('toLocaleLowerCase')).toBe(false)
    expect(code.includes('toLowerCase')).toBe(true)
  })

  it("converges 'People', 'people' and 'PEOPLE' on one molecule", async () => {
    const one = await moleculeAddress('People')
    expect(await moleculeAddress('people')).toBe(one)
    expect(await moleculeAddress('PEOPLE')).toBe(one)
    expect(await moleculeAddress('  people.  ')).toBe(one)
    expect(await moleculeAddress('—people—')).toBe(one)
  })

  it('folds punctuation and case, never meaning', async () => {
    expect(await moleculeAddress('notes')).not.toBe(await moleculeAddress('annotations'))
    expect(await moleculeAddress('note')).not.toBe(await moleculeAddress('notes'))
  })

  it('folds the WHOLE expression, so a symbol-only name still case-folds', async () => {
    // canon('Ⓐ') is '' (U+24B6 is a SYMBOL, not a letter), so the raw fallback
    // fires. The doc spelled this `fold(canon(name)) || trim(name)`, which
    // leaves the fallback branch unfolded and mints two molecules for one word.
    expect(canonicalizeLineageSegment('Ⓐ')).toBe('')
    expect(moleculeKey('Ⓐ')).toBe(moleculeKey('ⓐ'))
    expect(await moleculeAddress('Ⓐ')).toBe(await moleculeAddress('ⓐ'))
  })
})

describe('a symbol-only name does not collide with ROOT', () => {

  it('keeps a symbol-only name as its folded raw self', () => {
    expect(moleculeKey('---')).toBe('---')
    expect(moleculeKey('\u{1F600}')).toBe('\u{1F600}')
    expect(moleculeKey('***')).not.toBe('')
  })

  it('gives a symbol-only name an address that is NOT the root', async () => {
    const root = await rootMoleculeAddress()
    expect(await moleculeAddress('---')).not.toBe(root)
    expect(await moleculeAddress('\u{1F600}')).not.toBe(root)
    expect(await moleculeAddress('***')).not.toBe(await moleculeAddress('---'))
  })

  it('refuses an empty name rather than silently returning the root', async () => {
    await expect(moleculeAddress('')).rejects.toBeInstanceOf(RangeError)
    await expect(moleculeAddress('   ')).rejects.toBeInstanceOf(RangeError)
    await expect(moleculeAddress(null)).rejects.toBeInstanceOf(RangeError)
  })

  it('remembers the word behind an address it derived', async () => {
    const address = await moleculeAddress('Humidor')
    expect(moleculeWordOf(address)).toBe('humidor')
  })
})

describe('facets', () => {

  it("spells '<plural>:<subjectSig>'", () => {
    expect(facetPreimage('members', SIG)).toBe(`members:${SIG}`)
    expect(facetPreimage('Members', SIG)).toBe(`members:${SIG}`)
  })

  it('refuses a subject that is not a 64-hex signature', () => {
    expect(() => facetPreimage('members', 'a-collection')).toThrow(RangeError)
    expect(() => facetPreimage('members', SIG.slice(0, 63))).toThrow(RangeError)
    expect(() => facetPreimage('', SIG)).toThrow(RangeError)
  })

  it('is a different address from the bare plural word', async () => {
    expect(await facetAddress('members', SIG)).not.toBe(await moleculeAddress('members'))
  })

  it('is a different address for a different subject', async () => {
    expect(await facetAddress('members', SIG)).not.toBe(await facetAddress('members', 'b'.repeat(64)))
  })
})

describe('validatePoolSpelling', () => {

  it('REJECTS A:B with a reason and a compound-word suggestion', () => {
    const verdict = validatePoolSpelling('cigar:brand')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toContain('never a user word')
    expect(verdict.suggestion).toBe('cigar-brand')
  })

  it('accepts a reserved system scope', () => {
    for (const meaning of SCOPED_POOL_MEANINGS) {
      const verdict = validatePoolSpelling(meaning)
      expect(verdict.ok, `${meaning} was rejected`).toBe(true)
      if (verdict.ok) expect(['system', 'facet']).toContain(verdict.form)
    }
  })

  it('derives the reserved scopes rather than keeping a second list', () => {
    const scopes = reservedColonScopes()
    expect(scopes.has('search')).toBe(true)
    expect(scopes.has('molecule')).toBe(true)
    expect(scopes.has('cigar')).toBe(false)
  })

  it('accepts a facet — anything before a 64-hex subject', () => {
    const verdict = validatePoolSpelling(`members:${SIG}`)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.form).toBe('facet')
  })

  it('rejects a nested pool and a path', () => {
    expect(validatePoolSpelling('a:b:c').ok).toBe(false)
    expect(validatePoolSpelling('business/people').ok).toBe(false)
    expect(validatePoolSpelling('').ok).toBe(false)
  })

  it('ADVISES on a plural bare word — minting is free and cannot fail', () => {
    const verdict = validatePoolSpelling('notes')
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.form).toBe('molecule')
    expect(verdict.advice).toContain('singular')
  })

  it('does not advise on words that merely end in s', () => {
    for (const word of ['address', 'news', 'analysis', 'status', 'chaos']) {
      const verdict = validatePoolSpelling(word)
      expect(verdict.ok).toBe(true)
      if (verdict.ok) expect(verdict.advice, word).toBeUndefined()
    }
  })

  it('never rejects a bare word, however odd', () => {
    for (const word of ['cigar', 'people', 'notes', '日本語', 'a']) {
      expect(validatePoolSpelling(word).ok, word).toBe(true)
    }
  })
})
