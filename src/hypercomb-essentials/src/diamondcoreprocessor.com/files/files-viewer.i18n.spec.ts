// files-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// `files.close` and `files.empty` are SHARED with file-teaser, which stays in
// the shell — so they are carried here AND left there. A surface must carry
// everything it renders, and so must the one that did not move.
//
// The eleven `files.type.*` keys are not rendered by the view at all: they sit
// in file-icons.ts as a table of `labelKey`s and the view resolves
// `t(icon.labelKey)`. A key does not have to appear inside a t() call in the
// same file to be live. Note `files.type.other` is a FILE TYPE, not a plural
// variant of `files.type` — that key does not exist.

import { describe, expect, it } from 'vitest'
import { FILES_VIEWER_TRANSLATIONS } from './files-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'files.all',
  'files.close',
  'files.download',
  'files.empty',
  'files.remove',
  'files.selection',
  'files.selection.one',
  'files.type.archive',
  'files.type.audio',
  'files.type.code',
  'files.type.doc',
  'files.type.image',
  'files.type.other',
  'files.type.pdf',
  'files.type.sheet',
  'files.type.slides',
  'files.type.vector',
  'files.type.video',
  'files.viewer.title',
  'tags.scope-children',
  'tags.scope-global',
  'tags.scope-local',
].sort()

describe('files-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(FILES_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(FILES_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(FILES_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["files.", "tags."]
    for (const catalog of Object.values(FILES_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
