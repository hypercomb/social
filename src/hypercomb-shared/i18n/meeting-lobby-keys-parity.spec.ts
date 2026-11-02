import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE LOBBY SPEAKS EVERY LANGUAGE THE WINDOW DOES (2026-11-01).
//
// The meeting lobby calls these keys with an English fallback, so a missing
// key would not show as a raw key: it would show as English to a reader who
// chose another language. Every catalog carries every key with the same
// tokens, because a token dropped from a translation shows up as a blank
// ("of  here") instead of a number.

const DIR = __dirname
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
const en = read('en.json')

const KEYS = Object.keys(en).filter(k => k.startsWith('meeting.'))

/** The tokens each lobby line fills. */
const CONTRACT: Readonly<Record<string, readonly string[]>> = {
  'meeting.lobby-hint': ['{fps}', '{height}', '{mbps}', '{width}'],
  'meeting.lobby-actual': ['{height}', '{width}'],
  'meeting.lobby-here': ['{here}', '{needed}'],
  'meeting.lobby-waiting': ['{needed}'],
}

const tokensOf = (value: string): string[] => (value.match(/\{[a-z]+\}/g) ?? []).sort()

describe('meeting lobby keys', () => {
  it('has the lobby keys in English', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(25)
    for (const key of Object.keys(CONTRACT)) expect(en[key], key).toBeTruthy()
  })

  const locales = readdirSync(DIR).filter(f => f.endsWith('.json'))
  for (const file of locales) {
    it(`${file} carries every key with the same tokens`, () => {
      const catalog = read(file)
      for (const key of KEYS) {
        expect(catalog[key], `${file} ${key}`).toBeTruthy()
        expect(tokensOf(catalog[key]), `${file} ${key}`).toEqual(tokensOf(en[key]))
      }
      for (const [key, tokens] of Object.entries(CONTRACT)) {
        expect(tokensOf(catalog[key]), `${file} ${key}`).toEqual([...tokens])
      }
    })
  }
})
