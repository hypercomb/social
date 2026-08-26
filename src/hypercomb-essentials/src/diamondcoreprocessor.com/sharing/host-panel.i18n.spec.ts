// host-panel.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// NATIVE-ONLY SURFACE. The registration is wrapped in a native check, so on
// the web shell the module loads and the surface never appears — absence of
// registration IS the gate. The catalog still ships with it, because the
// element is DEFINED either way.

import { describe, expect, it } from 'vitest'
import { HOST_PANEL_TRANSLATIONS } from './host-panel.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'hosting.choose',
  'hosting.domain',
  'hosting.domain-placeholder',
  'hosting.folder',
  'hosting.get-cloudflared',
  'hosting.go-live',
  'hosting.go-offline',
  'hosting.live',
  'hosting.login',
  'hosting.no-cloudflared',
  'hosting.no-folder',
  'hosting.off',
  'hosting.on-port',
  'hosting.pill',
  'hosting.reading',
  'hosting.serving',
  'hosting.start',
  'hosting.stop',
  'hosting.title',
].sort()

describe('host-panel catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(HOST_PANEL_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(HOST_PANEL_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(HOST_PANEL_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["hosting."]
    for (const catalog of Object.values(HOST_PANEL_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
