// features-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// THE SIX `health.*` KEYS ARE BUILT AT RUNTIME from a stem, so no regex over
// the template could see them. `health.recovered` is shared with
// content-health.drone.ts and two `features.*` keys with the command shell and
// command line — all three carried here AND left in the shell.

import { describe, expect, it } from 'vitest'
import { FEATURES_VIEWER_TRANSLATIONS } from './features-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'features.allow',
  'features.applied.empty',
  'features.bound.only',
  'features.bound.to',
  'features.bulk.download',
  'features.bulk.download.hint',
  'features.bulk.hint.one',
  'features.bulk.hint.other',
  'features.chip.awaiting',
  'features.close',
  'features.default.clear',
  'features.default.on',
  'features.default.set',
  'features.download.active.one',
  'features.download.active.other',
  'features.download.done.one',
  'features.download.done.other',
  'features.download.failed',
  'features.download.partial.one',
  'features.download.partial.other',
  'features.download.stalled',
  'features.download.uptodate',
  'features.downloading',
  'features.empty',
  'features.enable.hint',
  'features.filter.behaviors',
  'features.filter.views',
  'features.foot.hint',
  'features.manage',
  'features.manage.hint',
  'features.note.noanswer',
  'features.open',
  'features.open.hint',
  'features.origin.cascade',
  'features.origin.cascade.root',
  'features.path.done',
  'features.path.failed',
  'features.path.receiving',
  'features.path.sent',
  'features.pool.anchored.hide',
  'features.pool.anchored.show',
  'features.remove.hint',
  'features.review.accept',
  'features.review.back',
  'features.review.bypass',
  'features.review.bypass.hint',
  'features.review.cancel',
  'features.review.note',
  'features.review.note.phone',
  'features.review.pending',
  'features.review.readcode',
  'features.review.title',
  'features.review.warn',
  'features.roster.bound',
  'features.roster.hint',
  'features.roster.off.hint',
  'features.roster.on.hint',
  'features.scope.hierarchy',
  'features.scope.layer',
  'features.search.placeholder',
  'features.selectTile',
  'features.selected.one',
  'features.selected.other',
  'features.selection',
  'features.selection.clear',
  'features.selection.one',
  'features.viewer.title',
  'features.where.global',
  'features.where.global.hint',
  'features.where.layer',
  'features.where.layer.hint',
  'health.host-down',
  'health.missing',
  'health.offline',
  'health.recovered',
  'health.tampered',
  'health.waiting',
].sort()

describe('features-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(FEATURES_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(FEATURES_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(FEATURES_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["features.", "health."]
    for (const catalog of Object.values(FEATURES_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
