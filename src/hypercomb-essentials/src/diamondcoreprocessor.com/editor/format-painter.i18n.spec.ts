// format-painter.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.

import { describe, expect, it } from 'vitest'
import { FORMAT_PAINTER_TRANSLATIONS } from './format-painter.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'format-painter.apply',
  'format-painter.empty',
  'format-painter.title',
].sort()

describe('format-painter catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(FORMAT_PAINTER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(FORMAT_PAINTER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(FORMAT_PAINTER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(FORMAT_PAINTER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('format-painter.'), key).toBe(true)
      }
    }
  })
})
