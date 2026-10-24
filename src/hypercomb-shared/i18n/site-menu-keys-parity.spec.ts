import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE WEBSITE'S RIGHT-CLICK SPEAKS EVERY LANGUAGE.
//
// On a published website the right button opens a menu (hypercomb-essentials/
// src/presentation/tiles/site-context-menu.ts) — Up one level, Hexagon view,
// Open in my hive, the page's link — and it is the one place a visitor learns
// the hexagons are there at all, and that the creation can live in a hive of
// their own. A key missing from a catalog falls through to the English, which
// is no way to meet someone reading in their own language. Narrow on purpose,
// like the create parity spec.

const DIR = __dirname
const KEYS = [
  'site-menu.label', 'site-menu.up', 'site-menu.hexagons', 'site-menu.open-home', 'site-menu.copy-page',
  'site-menu.copy-link', 'site-menu.copied', 'site-menu.copy-failed',
]

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('site menu — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries every row of the website menu`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
      }
    })
  }
})
