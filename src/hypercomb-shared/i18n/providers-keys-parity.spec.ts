import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE PROVIDERS CONSOLE SPEAKS EVERY LANGUAGE THE SHELL DOES.
//
// The console grew fast (OpenRouter, model lines, domain search, key guard,
// Remove/Restore) and its strings landed in en.json alone, reading as
// "providers.keyWrongRow" in thirteen languages. Twenty-five such keys had
// drifted before this ratchet existed.
//
// en.json is the reference: every `providers.*` key it carries must exist,
// non-empty, in every other catalog, and keep every `{placeholder}` the
// English has — a translated `{count}` renders as literal text. The list is
// DERIVED from en.json, not frozen here.

const DIR = __dirname
const REFERENCE = 'en.json'

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
const reference = read(REFERENCE)
const providerKeys = Object.keys(reference).filter(k => k.startsWith('providers.'))
const placeholders = (text: string): string[] => [...new Set(text.match(/\{[a-zA-Z]+\}/g) ?? [])].sort()

describe('providers console — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  it('en.json carries providers keys to compare against', () => {
    expect(providerKeys.length).toBeGreaterThan(0)
  })

  for (const file of catalogs) {
    if (file === REFERENCE) continue
    it(`${file} carries every providers.* key en.json does, non-empty, placeholders intact`, () => {
      const json = read(file)
      const missing = providerKeys.filter(key => typeof json[key] !== 'string')
      expect(missing, `${file} is missing ${missing.length} providers key(s)`).toEqual([])
      const empty = providerKeys.filter(key => json[key].trim() === '')
      expect(empty, `${file} has empty providers key(s)`).toEqual([])
      const broken = providerKeys.filter(key =>
        placeholders(reference[key]).join() !== placeholders(json[key]).join())
      expect(broken, `${file} changed placeholders in`).toEqual([])
    })
  }
})
