// sequence-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The panel's strings ship WITH the panel (sequence-viewer.i18n.ts). The 14
// shell catalogs used to drift silently against en.json; a module-carried
// catalog must not inherit that disease — so this pins: every locale carries
// exactly en's key set, every key belongs to this panel's namespace prefix,
// and en (the fallback locale) is present at all.

import { describe, expect, it } from 'vitest'
import { SEQUENCE_VIEWER_TRANSLATIONS } from './sequence-viewer.i18n.js'

describe('sequence-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(SEQUENCE_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    const en = Object.keys(SEQUENCE_VIEWER_TRANSLATIONS['en']).sort()
    for (const [locale, catalog] of Object.entries(SEQUENCE_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(en)
    }
  })

  it('every key belongs to this panel', () => {
    for (const catalog of Object.values(SEQUENCE_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('sequences.'), key).toBe(true)
      }
    }
  })
})
