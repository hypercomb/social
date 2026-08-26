// atomizer-bar.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.

import { describe, expect, it } from 'vitest'
import { ATOMIZER_BAR_TRANSLATIONS } from './atomizer-bar.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'atomizer.close',
  'atomizer.empty',
  'atomizer.title',
].sort()

describe('atomizer-bar catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(ATOMIZER_BAR_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(ATOMIZER_BAR_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(ATOMIZER_BAR_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["atomizer."]
    for (const catalog of Object.values(ATOMIZER_BAR_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
