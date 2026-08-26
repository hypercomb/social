// portal-overlay.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// TWO OF FIVE `portal.*` keys — the other three belong elsewhere.

import { describe, expect, it } from 'vitest'
import { PORTAL_OVERLAY_TRANSLATIONS } from './portal-overlay.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'portal.done',
  'portal.pending-changes',
].sort()

describe('portal-overlay catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(PORTAL_OVERLAY_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(PORTAL_OVERLAY_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(PORTAL_OVERLAY_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["portal."]
    for (const catalog of Object.values(PORTAL_OVERLAY_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
