// command-palette.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.

import { describe, expect, it } from 'vitest'
import { COMMAND_PALETTE_TRANSLATIONS } from './command-palette.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'palette.empty',
  'palette.placeholder',
  'palette.title',
].sort()

describe('command-palette catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(COMMAND_PALETTE_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(COMMAND_PALETTE_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(COMMAND_PALETTE_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["palette."]
    for (const catalog of Object.values(COMMAND_PALETTE_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
