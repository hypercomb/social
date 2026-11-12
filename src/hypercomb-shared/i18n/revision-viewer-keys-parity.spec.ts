import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE REVISION VIEWER SPEAKS EVERY LANGUAGE.
//
// `revisions` opens a website tile's own versions above the website
// (hypercomb-essentials/src/history/revision-viewer.view.ts): a slider, the
// runs of versions that show the same page, and the two marks that narrow a
// range down. A key missing from a catalog falls through to the English.
// Narrow on purpose, like the site menu parity spec.

const DIR = __dirname
const KEYS = [
  'slash.revisions', 'revisions.title', 'revisions.right', 'revisions.wrong', 'revisions.reset', 'revisions.close',
  'revisions.retry', 'revisions.position', 'revisions.loading', 'revisions.cold', 'revisions.no-page', 'revisions.none',
  'revisions.narrow-hint', 'revisions.narrow-next', 'revisions.narrow-found', 'revisions.page-run', 'revisions.stand-on',
  'revisions.older', 'revisions.newer', 'revisions.slider', 'revisions.failed',
]

/** The placeholders each key's English names, which every translation must keep. */
const PLACEHOLDERS: Record<string, readonly string[]> = {
  'revisions.position': ['{n}', '{count}'],
  'revisions.narrow-next': ['{left}', '{n}'],
  'revisions.narrow-found': ['{n}'],
  'revisions.page-run': ['{page}', '{from}', '{to}'],
  'revisions.failed': ['{reason}'],
}

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('revision viewer — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries every word of the revision viewer, with its placeholders`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
      }
      for (const [key, names] of Object.entries(PLACEHOLDERS)) {
        for (const name of names) expect(json[key], `${file} ${key} lost ${name}`).toContain(name)
      }
    })
  }
})
