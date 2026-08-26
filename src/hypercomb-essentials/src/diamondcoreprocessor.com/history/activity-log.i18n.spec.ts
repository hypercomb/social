// activity-log.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// TWO OF THESE ARE INVISIBLE TO A REGEX. `activity.mesh-public` and
// `activity.mesh-private` are chosen at runtime
// (`p.public ? … : …`), so the key never appears beside the `t()` that
// resolves it. The harvest missed both; the reconciliation against what the
// view actually calls t() with is what caught them. Pinning them here is what
// keeps them from being quietly dropped again.

import { describe, expect, it } from 'vitest'
import { ACTIVITY_LOG_TRANSLATIONS } from './activity-log.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'activity.added',
  'activity.dismiss',
  'activity.mesh-private',
  'activity.mesh-public',
  'activity.moved',
  'activity.paste-failed',
  'activity.pasted.one',
  'activity.pasted.other',
  'activity.removed',
  'activity.undo',
].sort()

describe('activity-log catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(ACTIVITY_LOG_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(ACTIVITY_LOG_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(ACTIVITY_LOG_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["activity."]
    for (const catalog of Object.values(ACTIVITY_LOG_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
