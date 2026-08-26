// observe-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// THREE OF THESE ARE BUILT AT RUNTIME. The template wrote
// `('observe.group.' + groupBy()) | t` over 'flat' | 'participant' | 'domain',
// and two more are chosen by ternary (names.on/off, names.hide/show). No regex
// over the original can see any of them — they were found by sweeping the
// prefix and confirmed against what the port passes to t(). Pinning them here
// is what stops the next refactor quietly dropping a grouping.

import { describe, expect, it } from 'vitest'
import { OBSERVE_VIEWER_TRANSLATIONS } from './observe-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'observe.by',
  'observe.changed',
  'observe.close',
  'observe.empty',
  'observe.group.domain',
  'observe.group.flat',
  'observe.group.hint',
  'observe.group.participant',
  'observe.interest',
  'observe.names.hide',
  'observe.names.off',
  'observe.names.on',
  'observe.names.show',
  'observe.title',
].sort()

describe('observe-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(OBSERVE_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(OBSERVE_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(OBSERVE_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["observe."]
    for (const catalog of Object.values(OBSERVE_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
