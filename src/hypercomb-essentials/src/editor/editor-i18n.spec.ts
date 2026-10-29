// The editor's words are in the catalog. Six keys once shipped in code and in
// no catalog at all, so the editor showed its own English fallback and nobody
// noticed. This ratchet reads every non-spec source under editor/ and fails on
// a literal `editor.*` key (passed to t( / tr( or named by `labelKey:`) that
// en.json does not hold. Other catalogs may lag: the runtime falls back to en.
// The name-flow keys and the six once-missing keys must be in all of them.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const i18nDir = join(here, '..', '..', '..', 'hypercomb-shared', 'i18n')

const catalog = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8'))

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : []
  })

const CALL = /\b(?:t|tr)\(\s*['"`](editor\.[A-Za-z0-9._-]+)['"`]/g
const LABEL = /\blabelKey:\s*['"`](editor\.[A-Za-z0-9._-]+)['"`]/g

const keysUsed = (): Map<string, string[]> => {
  const used = new Map<string, string[]>()
  for (const file of sources(here)) {
    const text = readFileSync(file, 'utf8')
    for (const pattern of [CALL, LABEL]) {
      pattern.lastIndex = 0
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        const where = used.get(m[1]) ?? []
        where.push(file.slice(here.length + 1).replace(/\\/g, '/'))
        used.set(m[1], where)
      }
    }
  }
  return used
}

const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh']

// Translated into every catalog.
const EVERYWHERE = [
  'editor.group-title', 'editor.group-as-is', 'editor.group-leave', 'editor.group-link',
  'editor.load-failed', 'editor.name-refused',
  'editor.name-failed', 'editor.name-reads', 'editor.name-dirty', 'editor.name-saving',
  'editor.name-saved', 'editor.name-taken-by', 'editor.name-undo', 'editor.unsaved', 'editor.saved',
]

describe('the editor catalog ratchet', () => {
  it('finds the editor sources and some keys in them', () => {
    expect(sources(here).length).toBeGreaterThan(5)
    expect(keysUsed().size).toBeGreaterThan(20)
  })

  it('every editor.* key the editor sources use is in en.json', () => {
    const en = catalog('en')
    const missing = [...keysUsed()]
      .filter(([key]) => !(key in en))
      .map(([key, files]) => `${key}  (${[...new Set(files)].join(', ')})`)
    expect(missing).toEqual([])
  })

  it('the keys that were in code and in no catalog are in all fourteen', () => {
    for (const locale of LOCALES) {
      const cat = catalog(locale)
      const missing = EVERYWHERE.filter(key => typeof cat[key] !== 'string' || cat[key] === '')
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
  })

  it('keeps every placeholder of the English value in each translation', () => {
    const en = catalog('en')
    const tokens = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort()
    for (const locale of LOCALES) {
      const cat = catalog(locale)
      for (const key of EVERYWHERE) {
        expect({ locale, key, tokens: tokens(cat[key] ?? '') })
          .toEqual({ locale, key, tokens: tokens(en[key]) })
      }
    }
  })

  it('never says rename or pheromone in an editor value', () => {
    for (const locale of LOCALES) {
      const cat = catalog(locale)
      const bad = Object.entries(cat)
        .filter(([key, value]) => key.startsWith('editor.') && /rename|pheromone/i.test(value))
        .map(([key]) => key)
      expect({ locale, bad }).toEqual({ locale, bad: [] })
    }
  })
})
