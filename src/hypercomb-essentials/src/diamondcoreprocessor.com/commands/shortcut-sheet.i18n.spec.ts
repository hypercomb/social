// shortcut-sheet.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// `shortcuts.chord-sep` is SHARED with the action card, and both carry it —
// see that spec for why duplicating it is the correct reading of one-catalog-
// per-surface.

import { describe, expect, it } from 'vitest'
import { SHORTCUT_SHEET_TRANSLATIONS } from './shortcut-sheet.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'shortcuts.chord-sep',
  'shortcuts.close',
  'shortcuts.empty',
  'shortcuts.filter-placeholder',
  'shortcuts.section.command-line',
  'shortcuts.section.keyboard',
  'shortcuts.section.slash',
  'shortcuts.title',
].sort()

describe('shortcut-sheet catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(SHORTCUT_SHEET_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(SHORTCUT_SHEET_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(SHORTCUT_SHEET_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["shortcuts."]
    for (const catalog of Object.values(SHORTCUT_SHEET_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
