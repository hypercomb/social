// mesh-modal.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// THE PREFIX IS `mesh-modal.`, NOT `mesh.`. The bare `mesh.` keys belong to
// controls-bar and mesh-header, both of which STAY — an early plan guessed the
// short prefix and would have moved a staying panel's strings out from under
// it. Hence the prefix assertion below, which would fail loudly if a `mesh.`
// key were ever folded in here.

import { describe, expect, it } from 'vitest'
import { MESH_MODAL_TRANSLATIONS } from './mesh-modal.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'mesh-modal.cancel',
  'mesh-modal.close',
  'mesh-modal.hide-secret',
  'mesh-modal.host-label',
  'mesh-modal.host-placeholder',
  'mesh-modal.label-label',
  'mesh-modal.label-placeholder',
  'mesh-modal.location-label',
  'mesh-modal.location-placeholder',
  'mesh-modal.needs-location',
  'mesh-modal.needs-secret',
  'mesh-modal.remove-saved',
  'mesh-modal.save',
  'mesh-modal.secret-label',
  'mesh-modal.secret-placeholder',
  'mesh-modal.share',
  'mesh-modal.share-copied',
  'mesh-modal.shared-behaviors',
  'mesh-modal.show-secret',
  'mesh-modal.skip-review',
  'mesh-modal.start',
  'mesh-modal.title',
].sort()

describe('mesh-modal catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(MESH_MODAL_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(MESH_MODAL_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(MESH_MODAL_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["mesh-modal."]
    for (const catalog of Object.values(MESH_MODAL_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
