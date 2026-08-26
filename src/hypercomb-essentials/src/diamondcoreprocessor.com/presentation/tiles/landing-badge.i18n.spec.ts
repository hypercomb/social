// landing-badge.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted against en.json silently for years. A
// module-carried catalog must not inherit that disease, so this pins the
// shape: the exact key set, present in every locale, with the plural forms
// the count param needs.

import { describe, expect, it } from 'vitest'
import { LANDING_BADGE_TRANSLATIONS } from './landing-badge.i18n.js'

/** What this panel renders. `landing.pending` is used with a `count` param,
 *  so it is backed by .one/.other — the service checks those FIRST and the
 *  bare key does not exist. Dropping them would silently un-pluralize the
 *  badge in all 14 languages. */
const EXPECTED = [
  'landing.aria',
  'landing.pending.one',
  'landing.pending.other',
  'landing.show',
  'landing.where',
].sort()

describe('landing-badge catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(LANDING_BADGE_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the panel’s key set, plural forms included', () => {
    expect(Object.keys(LANDING_BADGE_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(LANDING_BADGE_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this panel', () => {
    for (const catalog of Object.values(LANDING_BADGE_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('landing.'), key).toBe(true)
      }
    }
  })
})
