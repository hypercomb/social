// tile-editor.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// `editor.switch-to-flat` and `editor.switch-to-point` are SHARED with
// edit-actions, which stays — carried here, left there.

import { describe, expect, it } from 'vitest'
import { TILE_EDITOR_TRANSLATIONS } from './tile-editor.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'editor.bg',
  'editor.border',
  'editor.camera',
  'editor.cancel',
  'editor.drop-image',
  'editor.flat-top',
  'editor.hide-text',
  'editor.link',
  'editor.link-transforms',
  'editor.name',
  'editor.name-hint',
  'editor.name-taken',
  'editor.point-top',
  'editor.qa.answer-placeholder',
  'editor.qa.done',
  'editor.qa.title',
  'editor.save',
  'editor.search-google',
  'editor.show-text',
  'editor.switch-to-flat',
  'editor.switch-to-point',
  'editor.title',
  'editor.unlink-transforms',
  'editor.upload',
].sort()

describe('tile-editor catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(TILE_EDITOR_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(TILE_EDITOR_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(TILE_EDITOR_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["editor."]
    for (const catalog of Object.values(TILE_EDITOR_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
