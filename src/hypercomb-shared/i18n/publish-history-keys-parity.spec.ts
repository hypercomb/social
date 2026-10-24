import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// PUBLIC HISTORY SPEAKS EVERY LANGUAGE.
//
// `publish history on` (hypercomb-essentials/src/sharing/publish.queen.ts)
// answers with the one warning a publisher must not miss: whatever is served
// while history is public may be copied or cached elsewhere, and turning it
// off cannot take that back. A key missing from a catalog falls through to
// the English — no way to give that warning. Narrow on purpose, like the
// site-menu parity spec.

const DIR = __dirname
const KEYS = [
  'publish-history.usage', 'publish-history.status-public', 'publish-history.status-head',
  'publish-history.on', 'publish-history.off', 'publish-history.not-published',
]

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('public history — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries every public-history answer`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
        if (key !== 'publish-history.usage' && key !== 'publish-history.not-published') {
          expect(json[key], `${file} ${key} drops {name}`).toContain('{name}')
        }
      }
    })
  }
})
