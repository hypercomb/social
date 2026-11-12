import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// EDITING A WEBSITE'S WORDS SPEAKS EVERY LANGUAGE.
//
// The page's holder edits its text where they read it (hypercomb-essentials/
// src/presentation/tiles/site-text-edit.ts): the pencil, the input's hint and
// the reasons a save is refused. A key missing from a catalog falls through to
// the English. Narrow on purpose, like the site menu parity spec.

const DIR = __dirname
const KEYS = [
  'site-edit.start', 'site-edit.done', 'site-edit.placeholder', 'site-edit.hint',
  'site-edit.scripted', 'site-edit.failed', 'site-edit.offer-hint', 'site-edit.offered', 'site-edit.no-host',
  'site-versions.open', 'site-versions.local', 'site-versions.compare', 'site-versions.tick', 'site-versions.published',
  'site-versions.you', 'site-versions.words', 'site-versions.more', 'site-versions.same', 'site-versions.skip',
  'site-versions.pick', 'site-versions.picked', 'site-versions.picked-toast', 'site-versions.unpicked-toast', 'site-versions.no-hosts',
]

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('site text edit — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries every word of inline text editing`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
      }
    })
  }
})
