// trust-prompt.i18n.spec.ts — the drift check the catalog split owes.
//
// This surface gates CODE EXECUTION, so a missing string is not cosmetic: the
// prompt names the domain you are about to trust and labels the three exits.
// A locale short of a key would render a raw key where a decision is asked
// for. Note `trust-prompt.additional` takes a {count} param but has NO plural
// forms — the English reads "other source(s)" — so the bare key is correct
// here and its absence would be the bug.

import { describe, expect, it } from 'vitest'
import { TRUST_PROMPT_TRANSLATIONS } from './trust-prompt.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'trust-prompt.additional',
  'trust-prompt.allow-always',
  'trust-prompt.allow-once',
  'trust-prompt.deny',
  'trust-prompt.summary',
  'trust-prompt.title',
  'trust-prompt.warning',
].sort()

describe('trust-prompt catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(TRUST_PROMPT_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(TRUST_PROMPT_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(TRUST_PROMPT_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(TRUST_PROMPT_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('trust-prompt.'), key).toBe(true)
      }
    }
  })
})
