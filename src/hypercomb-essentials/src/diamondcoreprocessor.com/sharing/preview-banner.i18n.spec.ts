// preview-banner.i18n.spec.ts — the drift check the catalog split owes,
// plus the guard for a trap this extraction actually hit.
//
// THE TRAP: a prefix match on `preview.dismiss` also swallows
// `preview.dismissed` — a DIFFERENT key, belonging to hive-visit.drone's
// toast, which must stay in the shell catalogs. So the extraction matches
// EXACT keys plus their plural suffixes, never a prefix, and this spec pins
// that the neighbouring keys did not come along.

import { describe, expect, it } from 'vitest'
import { PREVIEW_BANNER_TRANSLATIONS } from './preview-banner.i18n.js'

/** What the banner renders. `preview.banner.tiles` takes a `count` param, so
 *  it is backed by .one/.other rather than a bare key. */
const EXPECTED = [
  'preview.adopt',
  'preview.banner.from',
  'preview.banner.tiles.one',
  'preview.banner.tiles.other',
  'preview.banner.title',
  'preview.dismiss',
].sort()

/** Same prefix family, different owner — hive-visit.drone's toasts. These
 *  must NOT have been dragged into the module catalog. */
const NOT_OURS = [
  'preview.collision',
  'preview.dismissed',
  'preview.started',
  'preview.unreachable',
  'preview.unreachable-bytes',
]

describe('preview-banner catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(PREVIEW_BANNER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the banner’s key set, plural forms included', () => {
    expect(Object.keys(PREVIEW_BANNER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(PREVIEW_BANNER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('never swallows the drone’s neighbouring keys (the prefix-bleed trap)', () => {
    for (const [locale, catalog] of Object.entries(PREVIEW_BANNER_TRANSLATIONS)) {
      for (const key of NOT_OURS) {
        expect(key in catalog, `${locale} must not carry ${key}`).toBe(false)
      }
    }
  })
})
