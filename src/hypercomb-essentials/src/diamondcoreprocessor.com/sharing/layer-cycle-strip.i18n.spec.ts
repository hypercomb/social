// layer-cycle-strip.i18n.spec.ts — the drift check the catalog split owes.

import { describe, expect, it } from 'vitest'
import { LAYER_CYCLE_TRANSLATIONS } from './layer-cycle-strip.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'layer-cycle.active',
  'layer-cycle.dismiss',
  'layer-cycle.spotlight',
].sort()

describe('layer-cycle-strip catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(LAYER_CYCLE_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(LAYER_CYCLE_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(LAYER_CYCLE_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(LAYER_CYCLE_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('layer-cycle.'), key).toBe(true)
      }
    }
  })
})
