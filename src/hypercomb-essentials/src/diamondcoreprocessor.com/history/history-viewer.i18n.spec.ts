// history-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// SEVENTEEN OF FORTY-THREE `history.*` keys. The rest belong to other history
// surfaces, which is why this was reference-derived rather than prefix-swept.
// `history.back` is shared with the history component that stays.

import { describe, expect, it } from 'vitest'
import { HISTORY_VIEWER_TRANSLATIONS } from './history-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'history.anchor-head',
  'history.anchor-start',
  'history.back',
  'history.close-slice',
  'history.copy-slice',
  'history.delete-entry',
  'history.group-step',
  'history.hide',
  'history.make-head',
  'history.mark-rename',
  'history.mark-toggle',
  'history.marked-empty',
  'history.marked-places',
  'history.prune-toggle',
  'history.save-as',
  'history.selection-make-head',
  'history.viewer-title',
].sort()

describe('history-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(HISTORY_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(HISTORY_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(HISTORY_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["history."]
    for (const catalog of Object.values(HISTORY_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
