// publish-panel.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// NINE OF THESE ARE BUILT AT RUNTIME, from the stem `publish.state.` — the
// panel resolves a state name into a label, so no regex over the template can
// see any of them. They are pinned here explicitly.
//
// `publish.title` is SHARED with publish-status.drone.ts, so it is carried
// here AND left in the shell.

import { describe, expect, it } from 'vitest'
import { PUBLISH_PANEL_TRANSLATIONS } from './publish-panel.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'publish.action.copy-link',
  'publish.action.publish',
  'publish.action.recheck',
  'publish.action.republish',
  'publish.action.unpublish',
  'publish.action.visit',
  'publish.empty',
  'publish.header.collision',
  'publish.header.gate-off',
  'publish.header.index-age',
  'publish.header.index-checking',
  'publish.header.index-forged',
  'publish.header.index-malformed',
  'publish.header.index-none',
  'publish.header.index-unreachable',
  'publish.header.key-mismatch',
  'publish.row.here-head',
  'publish.row.live-head',
  'publish.row.published-at',
  'publish.section.attention',
  'publish.section.changed',
  'publish.section.live',
  'publish.section.unpublished',
  'publish.state.cannot-compare',
  'publish.state.comparing',
  'publish.state.drift',
  'publish.state.gone',
  'publish.state.live',
  'publish.state.pending',
  'publish.state.stale-edge',
  'publish.state.unknown',
  'publish.state.unpublished',
  'publish.title',
  'publish.unpublish-warning',
  'publish.why.as-of',
  'publish.why.cold-child',
  'publish.why.confirming',
  'publish.why.drift',
  'publish.why.edge-lag',
  'publish.why.gaps',
  'publish.why.offline',
  'publish.why.other-device',
].sort()

describe('publish-panel catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(PUBLISH_PANEL_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(PUBLISH_PANEL_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(PUBLISH_PANEL_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["publish."]
    for (const catalog of Object.values(PUBLISH_PANEL_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
