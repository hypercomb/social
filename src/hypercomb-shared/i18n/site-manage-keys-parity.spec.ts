import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A MANAGED SITE DOOR'S BAR SPEAKS EVERY LANGUAGE.
//
// The owner's card at <name>.<zone>, once they opened /@hypercomb there
// (hypercomb-essentials/src/sharing/site-manage.view.ts), carries a thin bar:
// what is managed, the Chat, and the way back to the website — and, since the
// card became the page's own tile (site-replica.ts), what that tile holds:
// unpublished changes and their Publish (behind the consent dialog), a newer
// published card and its Use it, and why a card could not be brought in. A
// key missing from a catalog falls through to the English (and the consent
// dialog shows a missing key as its raw name).

const DIR = __dirname
const KEYS = [
  'site-manage.managing', 'site-manage.chat', 'site-manage.back', 'site-manage.loading',
  'site-manage.cold', 'site-manage.nothing', 'site-manage.retry',
  'site-manage.update', 'site-manage.updating', 'site-manage.update-failed',
  'site-manage.refused', 'site-manage.take-failed', 'site-manage.newer', 'site-manage.use-newer',
  'site-manage.taking', 'site-manage.unpublished', 'site-manage.publish', 'site-manage.publishing',
  'site-manage.published', 'site-manage.publish-failed', 'site-manage.publish-confirm.title',
  'site-manage.publish-confirm.message', 'site-manage.publish-confirm.cancel',
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
      for (const key of ['site-manage.update-failed', 'site-manage.refused', 'site-manage.take-failed', 'site-manage.publish-failed']) {
        expect(json[key], `${file} lost {reason} in ${key}`).toContain('{reason}')
      }
      expect(json['site-manage.publish-confirm.message'], `${file} lost {title}`).toContain('{title}')
    })
  }
})
