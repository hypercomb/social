import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A MANAGED SITE DOOR'S BAR SPEAKS EVERY LANGUAGE.
//
// The owner's card at <name>.<zone>, once they opened /@hypercomb there
// (hypercomb-essentials/src/sharing/site-manage.view.ts), carries a thin bar:
// what is managed, the Chat, and the way back to the website. A key missing
// from a catalog falls through to the English.

const DIR = __dirname
const KEYS = [
  'site-manage.managing', 'site-manage.chat', 'site-manage.back', 'site-manage.loading',
  'site-manage.cold', 'site-manage.nothing', 'site-manage.retry',
  'site-manage.update', 'site-manage.updating', 'site-manage.update-failed',
]

const catalogs = readdirSync(DIR).filter(f => f.endsWith('.json'))

describe('site manage — catalog parity', () => {
  it('finds every catalog', () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
  })

  for (const file of catalogs) {
    it(`${file} carries every word of the managed site's bar`, () => {
      const json = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]?.trim(), `${file} has an empty ${key}`).not.toBe('')
      }
      expect(json['site-manage.managing'], `${file} lost {title}`).toContain('{title}')
      expect(json['site-manage.update-failed'], `${file} lost {reason}`).toContain('{reason}')
    })
  }
})
