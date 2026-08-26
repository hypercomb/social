// action-card.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// `shortcuts.chord-sep` is SHARED with the shortcut sheet, and both carry it.
// A surface must carry everything it renders — registerTranslations merges,
// so the duplicate composes harmlessly, and neither surface depends on the
// other (or on the shell) being loaded to draw a chord separator.
//
// `action.hover.gesture` / `action.hover.shortcut` are ternary-selected in
// the template and were invisible to the key harvest; see the activity-log
// spec for the same class.

import { describe, expect, it } from 'vitest'
import { ACTION_CARD_TRANSLATIONS } from './action-card.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'action.hover.aliases',
  'action.hover.close',
  'action.hover.gesture',
  'action.hover.options',
  'action.hover.shortcut',
  'action.hover.title',
  'action.hover.usage',
  'shortcuts.chord-sep',
].sort()

describe('action-card catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(ACTION_CARD_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(ACTION_CARD_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(ACTION_CARD_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["action.", "shortcuts."]
    for (const catalog of Object.values(ACTION_CARD_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
