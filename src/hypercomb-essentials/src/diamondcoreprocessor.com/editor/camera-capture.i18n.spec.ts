// camera-capture.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.

import { describe, expect, it } from 'vitest'
import { CAMERA_CAPTURE_TRANSLATIONS } from './camera-capture.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'camera.close',
  'camera.flip',
  'camera.hint',
  'camera.shutter',
  'camera.title',
].sort()

describe('camera-capture catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(CAMERA_CAPTURE_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(CAMERA_CAPTURE_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(CAMERA_CAPTURE_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["camera."]
    for (const catalog of Object.values(CAMERA_CAPTURE_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
