// aggregate-index.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// THREE PREFIXES, and only the keys the panel REFERENCES moved.
// `website-landing.` holds five keys in en.json and this surface renders one;
// sweeping the prefix would have taken the other four from a surface that
// stays. `collections-landing.title` is shared with the tutorial lessons, so
// it is carried here AND left in the shell.

import { describe, expect, it } from 'vitest'
import { AGGREGATE_INDEX_TRANSLATIONS } from './aggregate-index.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'aggregate.applied.marked',
  'aggregate.applied.marked.one',
  'aggregate.applied.message',
  'aggregate.applied.message.one',
  'aggregate.applied.skipped',
  'aggregate.applied.skipped.one',
  'aggregate.applied.title',
  'aggregate.applied.title.one',
  'aggregate.apply-here',
  'aggregate.apply-here.one',
  'aggregate.apply.hint',
  'aggregate.apply.none.message',
  'aggregate.apply.none.message.one',
  'aggregate.apply.none.title',
  'aggregate.apply.with-marks',
  'aggregate.carry.add',
  'aggregate.carry.clear',
  'aggregate.carry.remove',
  'aggregate.carrying',
  'aggregate.carrying.one',
  'aggregate.close',
  'aggregate.context.added.message',
  'aggregate.context.added.title',
  'aggregate.context.failed.message',
  'aggregate.context.failed.title',
  'aggregate.create-named',
  'aggregate.empty',
  'aggregate.filter',
  'aggregate.filter-clear',
  'aggregate.home',
  'aggregate.home.pin',
  'aggregate.home.unpin',
  'aggregate.new',
  'aggregate.no-match',
  'aggregate.remove',
  'aggregate.rename',
  'aggregate.return',
  'aggregate.version-active',
  'aggregate.versions',
  'aggregate.versions-empty',
  'aggregate.versions-loading',
  'aggregate.versions-local',
  'aggregate.versions-published',
  'collections-landing.add',
  'collections-landing.add-here',
  'collections-landing.add-hint',
  'collections-landing.add-to',
  'collections-landing.add-to.one',
  'collections-landing.add-to.other',
  'collections-landing.add.one',
  'collections-landing.add.other',
  'collections-landing.lede',
  'collections-landing.move',
  'collections-landing.move-hint',
  'collections-landing.move-to',
  'collections-landing.move-to.one',
  'collections-landing.move-to.other',
  'collections-landing.move.one',
  'collections-landing.move.other',
  'collections-landing.new',
  'collections-landing.title',
  'website-landing.title',
].sort()

describe('aggregate-index catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(AGGREGATE_INDEX_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(AGGREGATE_INDEX_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(AGGREGATE_INDEX_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["aggregate.", "collections-landing.", "website-landing."]
    for (const catalog of Object.values(AGGREGATE_INDEX_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
