// youtube-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// `viewer.watchOnYouTube` carries CAPITALS, and the first key harvest for this
// batch used a lowercase-only pattern and missed it. An under-harvested key is
// one that stays in the shell catalogs after its surface leaves — resolving by
// luck until someone prunes them. Pinning the set here is what makes that
// mistake loud instead of silent.

import { describe, expect, it } from 'vitest'
import { YOUTUBE_VIEWER_TRANSLATIONS } from './youtube-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'viewer.close',
  'viewer.watchOnYouTube',
].sort()

describe('youtube-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(YOUTUBE_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(YOUTUBE_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(YOUTUBE_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(YOUTUBE_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('viewer.'), key).toBe(true)
      }
    }
  })
})
