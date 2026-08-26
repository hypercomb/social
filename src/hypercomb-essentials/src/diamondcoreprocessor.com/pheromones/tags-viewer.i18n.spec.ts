// tags-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// THE THREE `tags.scope-*` KEYS ARE BUILT AT RUNTIME, from a template literal
// whose stem ends in a HYPHEN — the exact shape that slipped past the harvest,
// the extractor and the reconciler simultaneously one batch ago. They are also
// SHARED with files-viewer and controls-bar, so they are carried here and left
// in the shell. `tags.viewer.title` is shared with notes-strip, which is still
// Angular.

import { describe, expect, it } from 'vitest'
import { TAGS_VIEWER_TRANSLATIONS } from './tags-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'tags.active.label',
  'tags.active.none',
  'tags.apply',
  'tags.apply.hint.short',
  'tags.bouquet.collapse',
  'tags.bouquet.expand',
  'tags.bouquet.forget',
  'tags.bouquet.hint',
  'tags.bouquet.load',
  'tags.bouquet.name.cancel',
  'tags.bouquet.name.commit',
  'tags.bouquet.name.placeholder',
  'tags.bouquet.save',
  'tags.bouquet.save.hint',
  'tags.bouquet.title',
  'tags.bouquet.unnamed',
  'tags.clear',
  'tags.close',
  'tags.count.hint',
  'tags.drag.hint',
  'tags.empty',
  'tags.inhand.hint',
  'tags.inhand.putdown',
  'tags.inhand.putdown.hint',
  'tags.inhand.selection',
  'tags.inhand.selection.one',
  'tags.intro',
  'tags.list.loose.title',
  'tags.list.namespaces.hint',
  'tags.list.namespaces.title',
  'tags.list.title',
  'tags.namespace.toggle',
  'tags.painter.deselect',
  'tags.painter.deselect.hint',
  'tags.recolor',
  'tags.removal.all',
  'tags.removal.cancel',
  'tags.removal.commit',
  'tags.removal.commit.hint',
  'tags.removal.commit.one',
  'tags.removal.commit.zero',
  'tags.removal.empty',
  'tags.removal.forget',
  'tags.removal.hint',
  'tags.removal.title',
  'tags.remove',
  'tags.remove.hint',
  'tags.scope-children',
  'tags.scope-global',
  'tags.scope-local',
  'tags.search.clear',
  'tags.search.none',
  'tags.search.placeholder',
  'tags.viewer.title',
].sort()

describe('tags-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(TAGS_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(TAGS_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(TAGS_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["tags."]
    for (const catalog of Object.values(TAGS_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
