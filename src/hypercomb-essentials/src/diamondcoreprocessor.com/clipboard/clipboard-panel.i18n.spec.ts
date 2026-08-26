// clipboard-panel.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// `selection.copy` and `selection.cut` are SHARED with edit-actions, which
// stays — carried here, left there. The rest of the `selection.` prefix
// belongs to that component and was not touched.

import { describe, expect, it } from 'vitest'
import { CLIPBOARD_PANEL_TRANSLATIONS } from './clipboard-panel.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'clipboard.back',
  'clipboard.children.one',
  'clipboard.children.other',
  'clipboard.clear',
  'clipboard.close',
  'clipboard.discard',
  'clipboard.empty',
  'clipboard.hint',
  'clipboard.noChildren',
  'clipboard.placeAll',
  'clipboard.resize',
  'clipboard.selection',
  'clipboard.selection.one',
  'clipboard.swap',
  'clipboard.swapOrWalk',
  'clipboard.title',
  'clipboard.walkIn',
  'selection.copy',
  'selection.cut',
].sort()

describe('clipboard-panel catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(CLIPBOARD_PANEL_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(CLIPBOARD_PANEL_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(CLIPBOARD_PANEL_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["clipboard.", "selection."]
    for (const catalog of Object.values(CLIPBOARD_PANEL_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
