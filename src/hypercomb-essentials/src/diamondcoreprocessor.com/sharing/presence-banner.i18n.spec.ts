// presence-banner.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// EIGHT of the ten `presence.` keys. `presence.one-here` and
// `presence.many-here` are rendered by nothing — an earlier presence banner
// wrote them and they outlived it. They stayed in the shell catalogs on
// purpose: strings move with their SURFACE, and dead ones have none. Deleting
// translations across 14 languages is a deliberate act, not a side effect of a
// conversion — so this guard keeps them out of here without pretending to
// decide their fate.

import { describe, expect, it } from 'vitest'
import { PRESENCE_BANNER_TRANSLATIONS } from './presence-banner.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'presence.alone',
  'presence.expand',
  'presence.filter-toggle',
  'presence.follow',
  'presence.name-placeholder',
  'presence.panel-label',
  'presence.set-name',
  'presence.subscribe',
].sort()

/** Orphans left behind in the shell catalogs — not this surface's. */
const ORPHANS = [
  'presence.one-here',
  'presence.many-here',
]

describe('presence-banner catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(PRESENCE_BANNER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(PRESENCE_BANNER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(PRESENCE_BANNER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(PRESENCE_BANNER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('presence.'), key).toBe(true)
      }
    }
  })

  it('never adopts the orphaned keys nothing renders', () => {
    for (const [locale, catalog] of Object.entries(PRESENCE_BANNER_TRANSLATIONS)) {
      for (const key of ORPHANS) {
        expect(key in catalog, `${locale} must not carry ${key}`).toBe(false)
      }
    }
  })
})
