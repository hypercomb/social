// notes-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// EIGHT OF THESE TWELVE ARE SHARED WITH notes-strip, which is still Angular in
// the shell — so they are carried here AND left there. Only four actually
// moved.
//
// This is also why the `notes.` prefix was never SWEPT: en.json holds 102
// `notes.*` keys and this panel renders twelve. Sweeping would have taken the
// notes strip's entire vocabulary with it.

import { describe, expect, it } from 'vitest'
import { NOTES_VIEWER_TRANSLATIONS } from './notes-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'notes.add.another',
  'notes.close',
  'notes.edit',
  'notes.viewer.aria',
  'notes.viewer.depth',
  'notes.viewer.dropHint',
  'notes.viewer.hierarchies',
  'notes.viewer.next',
  'notes.viewer.pheromones',
  'notes.viewer.position',
  'notes.viewer.prev',
  'notes.viewer.untag',
].sort()

describe('notes-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(NOTES_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(NOTES_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(NOTES_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["notes."]
    for (const catalog of Object.values(NOTES_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
