// example-hives.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// The four `hive.empty.*` keys are SHARED — hive-eject.html and the
// collection-empty-prompt drone draw them too — so they are duplicated here
// and left in the shell rather than moved.

import { describe, expect, it } from 'vitest'
import { EXAMPLE_HIVES_TRANSLATIONS } from './example-hives.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'examples.offer.add',
  'examples.offer.added',
  'examples.offer.adding',
  'examples.offer.dismiss',
  'examples.offer.done',
  'examples.offer.examples-note',
  'examples.offer.examples-title',
  'examples.offer.eyebrow',
  'examples.offer.or',
  'examples.offer.retry',
  'examples.offer.subtitle',
  'examples.offer.tiles.one',
  'examples.offer.tiles.other',
  'examples.offer.title',
  'hive.empty.action',
  'hive.empty.action.detail',
  'hive.empty.tour',
  'hive.empty.tour.detail',
].sort()

describe('example-hives catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(EXAMPLE_HIVES_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(EXAMPLE_HIVES_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(EXAMPLE_HIVES_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["examples.", "hive."]
    for (const catalog of Object.values(EXAMPLE_HIVES_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
