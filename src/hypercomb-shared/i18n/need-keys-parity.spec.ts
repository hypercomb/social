import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE SERVERS FEEDING A NEED SPEAK EVERY LANGUAGE.
//
// The `need` word (hypercomb-essentials/src/sharing/need-feeds.queen.ts) draws
// the hosts as a row feeding one list. A key missing from a catalog falls
// through to the English. Narrow on purpose, like the site edit parity spec.

const DIR = __dirname
const KEYS = [
  'slash.need', 'need.brand', 'need.close', 'need.stand', 'need.no-hosts', 'need.summary',
  'need.asking', 'need.empty', 'need.silent', 'need.answered', 'need.waiting', 'need.nothing',
  'need.fed-by', 'need.added', 'need.promote', 'need.promote-failed', 'need.promoted',
  'need.offer', 'need.offer-title', 'need.offer-done', 'need.offer-root', 'need.offer-nohost',
  'need.offer-empty', 'need.offer-failed', 'need.via-offer', 'need.via-tile',
]

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('need feeds — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries every word of the need view`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
      }
      // Every placeholder the English names survives the translation.
      for (const key of KEYS) {
        const tokens = (JSON.parse(readFileSync(join(DIR, 'en.json'), 'utf8'))[key] as string).match(/\{[a-z]+\}/g) ?? []
        for (const token of tokens) expect(json[key], `${file} ${key} lost ${token}`).toContain(token)
      }
    })
  }
})
