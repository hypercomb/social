import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A RECIPE IS SHARED IN EVERY LANGUAGE.
//
// The desk, the read-along, pools mode, the shelf, the catalogue and the phone's
// post form (recipe/*, pools/*) draw every word from the catalogues. A phone that
// lands on a leader's page in German must not meet the form in English, so every
// recipe, pools and entries word the English carries is carried by every
// catalogue, with every placeholder intact. Unlike the narrow parity specs this
// one takes the keys from en.json by prefix, so a new word cannot ship English-only.

const DIR = __dirname
const PREFIXES = ['recipe.', 'pools.', 'entries.']
const en = JSON.parse(readFileSync(join(DIR, 'en.json'), 'utf8')) as Record<string, string>
const KEYS = Object.keys(en).filter(key => PREFIXES.some(prefix => key.startsWith(prefix)))
const placeholders = (text: string): string[] => [...new Set(text.match(/\{[A-Za-z0-9_]+\}/g) ?? [])]

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('recipe sharing — catalog parity', () => {
  it('finds every catalog, and the English has the words', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
    expect(KEYS.length).toBeGreaterThan(400)
  })

  for (const file of catalogs) {
    it(`${file} carries every recipe, pools and entries word, placeholders intact`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      const missing = KEYS.filter(key => typeof json[key] !== 'string' || json[key].trim() === '')
      expect(missing, `${file} is missing ${missing.length}: ${missing.slice(0, 8).join(', ')}`).toEqual([])
      const lost = KEYS.flatMap(key => placeholders(en[key]).filter(token => !json[key].includes(token)).map(token => `${key} ${token}`))
      expect(lost, `${file} lost placeholders`).toEqual([])
    })
  }
})
