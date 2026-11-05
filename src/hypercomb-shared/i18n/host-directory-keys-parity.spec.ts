import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE HOST DESK SPEAKS ENGLISH AND JAPANESE (2026-11-04).
//
// The desk calls every string with an English fallback, so a key missing from a
// catalog does not show as a raw key: it shows as English to a reader who chose
// another language — and for most of its life the desk did exactly that, in
// Japanese, for 66 strings. English is the source and Japanese is the one other
// catalog kept whole; the rest are brought up to date in their own sweeps
// (documentation/ and the i18n register notes), so they are not asked here.
//
// A token dropped from a translation shows up as a blank ("of  here") instead
// of a number, and one invented shows up as a literal "{name}", so the tokens
// must match exactly.

const DIR = __dirname
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
const VIEW = readFileSync(join(DIR, '..', '..', 'hypercomb-essentials', 'src', 'sharing', 'host-directory.view.ts'), 'utf8')
const en = read('en.json')
const ja = read('ja.json')

/** Every `t('key', 'English fallback')` the desk draws. */
const KEYS = new Map<string, string>()
for (const match of VIEW.matchAll(/\bt\(\s*'([a-z0-9][a-z0-9._-]*)'\s*,\s*'((?:[^'\\]|\\.)*)'/gi)) KEYS.set(match[1]!, match[2]!)

const tokensOf = (value: string | undefined): string[] => (value?.match(/\{[a-z]+\}/g) ?? []).sort()
/** What a catalog says for many: its plural form when it has one, else the plain key. */
const many = (catalog: Record<string, string>, key: string): string | undefined => catalog[`${key}.other`] ?? catalog[key]

describe('host directory keys', () => {
  it('finds the strings the desk draws', () => {
    expect(KEYS.size).toBeGreaterThanOrEqual(100)
    for (const key of ['hosts.manage', 'hosts.light.behind', 'hosts.code.look', 'hosts.published-here', 'hosts.stacked']) {
      expect(KEYS.has(key), key).toBe(true)
    }
  })

  it('has every one of them in English', () => {
    expect([...KEYS.keys()].filter(key => many(en, key) === undefined)).toEqual([])
  })

  it('has every one of them in Japanese, translated and not copied', () => {
    expect([...KEYS.keys()].filter(key => many(ja, key) === undefined)).toEqual([])
    const copied = [...KEYS.keys()].filter(key => {
      const word = many(en, key) ?? ''
      // A short Latin-only label may be the same word in both (nothing here is, today).
      return word.length > 3 && many(ja, key) === word
    })
    expect(copied).toEqual([])
    // A translation is Japanese: it has kana or kanji in it.
    expect([...KEYS.keys()].filter(key => !/[぀-ヿ一-鿿]/.test(many(ja, key) ?? ''))).toEqual([])
  })

  it('keeps every token a translation was given, and invents none', () => {
    for (const key of KEYS.keys()) {
      expect(tokensOf(many(ja, key)), `ja ${key}`).toEqual(tokensOf(many(en, key)))
    }
  })

  it('says in English what the fallback in the code says, token for token', () => {
    for (const [key, fallback] of KEYS) {
      expect(tokensOf(many(en, key)), `en ${key}`).toEqual(tokensOf(fallback))
    }
  })

  it('gives a count its singular where English needs one', () => {
    expect(en['hosts.code.more.one']).toBe('Show the other line')
    expect(tokensOf(en['hosts.code.more.other'])).toEqual(['{count}'])
    expect(en['hosts.code.more.one']).not.toMatch(/\{count\}/)
    // Japanese has no plural: one plain key carries the number.
    expect(tokensOf(ja['hosts.code.more'])).toEqual(['{count}'])
  })

  it('describes the hosts word in both languages — its autocomplete line was English for everyone', () => {
    expect(en['slash.hosts']).toBeTruthy()
    expect(ja['slash.hosts']).toMatch(/[぀-ヿ一-鿿]/)
    // The word's own description, in the code, says what the window is now: columns, stacking, code.
    const QUEEN = readFileSync(join(DIR, '..', '..', 'hypercomb-essentials', 'src', 'sharing', 'hosts.queen.ts'), 'utf8')
    expect(QUEEN).toMatch(/browse what your hosts carry in columns, stack several to search them together, read the code/)
    expect(QUEEN).not.toMatch(/inspect its packages, and add one to your hive/)
  })
})
