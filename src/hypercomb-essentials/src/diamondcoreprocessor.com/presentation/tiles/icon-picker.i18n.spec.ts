// icon-picker.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.

import { describe, expect, it } from 'vitest'
import { ICON_PICKER_TRANSLATIONS } from './icon-picker.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'icon-picker.clear-search',
  'icon-picker.close',
  'icon-picker.count',
  'icon-picker.empty',
  'icon-picker.search-label',
  'icon-picker.search-placeholder',
  'icon-picker.title',
].sort()

describe('icon-picker catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(ICON_PICKER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(ICON_PICKER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(ICON_PICKER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(ICON_PICKER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('icon-picker.'), key).toBe(true)
      }
    }
  })
})
