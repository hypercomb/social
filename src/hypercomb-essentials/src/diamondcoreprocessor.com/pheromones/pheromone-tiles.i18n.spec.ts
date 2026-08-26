// pheromone-tiles.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.

import { describe, expect, it } from 'vitest'
import { PHEROMONE_TILES_TRANSLATIONS } from './pheromone-tiles.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'pheromone.card.close',
  'pheromone.card.peek.hint',
  'pheromone.card.pin',
  'pheromone.card.remove',
  'pheromone.card.remove.hint',
  'pheromone.card.title',
].sort()

describe('pheromone-tiles catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(PHEROMONE_TILES_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(PHEROMONE_TILES_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(PHEROMONE_TILES_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["pheromone."]
    for (const catalog of Object.values(PHEROMONE_TILES_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
