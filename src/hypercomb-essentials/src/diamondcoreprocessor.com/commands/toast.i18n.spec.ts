// toast.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years. A
// module-carried catalog must not inherit that disease: this pins the exact
// key set and its presence in every locale.

import { describe, expect, it } from 'vitest'
import { TOAST_TRANSLATIONS } from './toast.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'toast.dismiss',
].sort()

describe('toast catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(TOAST_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(TOAST_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(TOAST_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(TOAST_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('toast.'), key).toBe(true)
      }
    }
  })
})
