// drafts-counts.spec.ts — HOME, HELD (jwize, 2026-11-20): the words that
// count code drafts read right for one and for many. The catalog switches to
// `.one`/`.other` only when `count` is passed, so every caller passes it
// (site-manage.view.ts, publish-status.drone.ts), and English carries both
// forms; a locale with no plural (ja) answers from its one bare key.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Globals = typeof globalThis & { register?: (key: string, value: unknown) => void; get?: (key: string) => unknown }
const registry = new Map<string, unknown>()
;(globalThis as Globals).register = (key, value) => { registry.set(key, value) }
;(globalThis as Globals).get = (key) => registry.get(key)

const catalog = (file: string): Record<string, string> => JSON.parse(readFileSync(join(__dirname, file), 'utf8')) as Record<string, string>

const load = async (locale: string) => {
  vi.resetModules()
  registry.clear()
  localStorage.setItem('hc:locale', locale)
  await import('../../hypercomb-runtime/src/i18n.service')
  const i18n = registry.get('@hypercomb.social/I18n') as { t(key: string, params?: Record<string, string | number>): string; registerTranslations(ns: string, locale: string, c: Record<string, string>): void }
  i18n.registerTranslations('app', 'en', catalog('en.json'))
  i18n.registerTranslations('app', 'ja', catalog('ja.json'))
  return i18n
}

const COUNTED = [
  ['site-manage.drafts.home', { drafts: 1, count: 1 }, '1 code draft came home, held until you accept it.'],
  ['site-manage.drafts.other-build', { drafts: 1, count: 1 }, '1 code draft waits for the same build here: Update, then open the card again.'],
  ['site-manage.drafts.older-build', { drafts: 1, count: 1 }, '1 code draft was written over an older build than this device runs, so it cannot come home here: draft it again here.'],
  ['site-manage.drafts.tampered', { drafts: 1, count: 1 }, '1 code draft the card carried did not pass the checks here, so it stays out: draft it again here.'],
  ['publish.take.other-build', { drafts: 1, count: 1 }, '1 code draft was written over another build and stays out of this hive.'],
  ['publish.take.drafts-waiting', { drafts: 1, count: 1 }, '1 code draft did not come home yet. It is tried again while this card is the one published.'],
  ['site-manage.publish-confirm.drafts-all-off', { title: 'card', drafts: 0, dropped: 1, count: 1 }, 'Your changes to card go live for everyone who visits the site. 1 code draft this device no longer runs comes off the card, so it stops arriving on your other devices.'],
] as const

describe('counted drafts words', () => {
  it('say one draft in the singular and many in the plural', async () => {
    const i18n = await load('en')
    for (const [key, params, one] of COUNTED) expect(i18n.t(key, params)).toBe(one)
    expect(i18n.t('site-manage.drafts.home', { drafts: 3, count: 3 })).toBe('3 code drafts came home, held until you accept them.')
    expect(i18n.t('publish.take.drafts-waiting', { drafts: 2, count: 2 })).toBe('2 code drafts did not come home yet. They are tried again while this card is the one published.')
    expect(i18n.t('site-manage.publish-confirm.drafts-off', { title: 'card', drafts: 2, dropped: 3, count: 3 }))
      .toContain('with your code drafts (2). 3 code drafts this device no longer runs come off the card')
  })

  it('a locale with no plural still answers from its one key', async () => {
    const i18n = await load('ja')
    expect(i18n.t('site-manage.drafts.home', { drafts: 1, count: 1 })).toBe(catalog('ja.json')['site-manage.drafts.home']!.replace('{drafts}', '1'))
  })
})
