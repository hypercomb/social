// hypercomb-shared/core/theme-words.spec.ts — A THEME CARRIES WORDS.
//
// jwize, 2026-10-02: "doctrine wins, rename to tags" — "we will skin it as a
// beehive later for my own version" — "it should be part of a theme" — "we
// need to be able to change them around to our own liking". So the default
// vocabulary calls a tile's marks TAGS (a pheromone is an authored interest-
// signal, documentation/pheromones.md, never a label), and the hive wording
// that called them pheromones became the beehive theme's words. Three layers,
// in this order: the participant's own overrides, the active theme's words,
// the shipped catalog.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

;(globalThis as { register?: unknown }).register = (): void => {}

const root = process.cwd()
const i18nDir = join(root, 'hypercomb-shared', 'i18n')
const catalog = (locale: string): Record<string, string> => JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8'))
const beehive = JSON.parse(readFileSync(join(root, 'hypercomb-essentials', 'src', 'commands', 'beehive.words.json'), 'utf8')) as Record<string, Record<string, string>>
const PHEROMONE = /pheromon|feromon|phéromon|フェロモン|페로몬|信息素|феромон|فيرومون|फेरोमोन/i

const service = async () => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('hc:locale', 'en')
  const { LocalizationService } = await import('../../hypercomb-runtime/src/i18n.service.js')
  const i18n = new LocalizationService()
  i18n.setLocale('en')
  i18n.registerTranslations('app', 'en', { 'tags.viewer.title': 'Tags', 'editor.save': 'Save' })
  return i18n
}

describe('the vocabulary layers', () => {
  it('the shipped catalog answers when nothing shadows it', async () => {
    const i18n = await service()
    expect(i18n.t('tags.viewer.title')).toBe('Tags')
  })

  it("a theme's words shadow the catalog, and clearing them restores it", async () => {
    const i18n = await service()
    i18n.setThemeWords({ en: { 'tags.viewer.title': 'Pheromones' } })
    expect(i18n.t('tags.viewer.title')).toBe('Pheromones')
    expect(i18n.t('editor.save')).toBe('Save')   // a word the theme does not carry
    i18n.setThemeWords(undefined)
    expect(i18n.t('tags.viewer.title')).toBe('Tags')
  })

  it("the participant's own override outranks any theme", async () => {
    const i18n = await service()
    i18n.setThemeWords({ en: { 'tags.viewer.title': 'Pheromones' } })
    i18n.registerOverrides('app', 'en', { 'tags.viewer.title': 'Marks' })
    expect(i18n.t('tags.viewer.title')).toBe('Marks')
  })

  it("a module's own namespace is never reworded by a theme", async () => {
    const i18n = await service()
    i18n.registerTranslations('revolucionstyle.com', 'en', { 'tags.viewer.title': 'Humidor' })
    i18n.setThemeWords({ en: { 'tags.viewer.title': 'Pheromones' } })
    expect(i18n.t('tags.viewer.title', undefined, 'revolucionstyle.com')).toBe('Humidor')
  })
})

describe('the theme hands its words over', () => {
  const load = async (stored: string) => {
    vi.resetModules()
    localStorage.clear()
    localStorage.setItem('hc:theme', stored)
    const handed: (Record<string, Record<string, string>> | undefined)[] = []
    const i18n = { setThemeWords: (words?: Record<string, Record<string, string>>) => { handed.push(words) } }
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: (key: string) => key === '@hypercomb.social/I18n' ? i18n : undefined,
      whenReady: (_key: string, cb: () => void) => cb(),
    }
    const mod = await import('./theme.service.js')
    return { theme: new mod.ThemeService(), handed }
  }

  it('the active theme registering words hands them over at once; switching away takes them off', async () => {
    const { theme, handed } = await load('beehive')
    theme.registerThemeWords('beehive', { en: { 'tags.viewer.title': 'Pheromones' } })
    expect(handed[handed.length - 1]).toEqual({ en: { 'tags.viewer.title': 'Pheromones' } })
    theme.setTheme('honey')
    expect(handed[handed.length - 1]).toBeUndefined()
    theme.setTheme('beehive')
    expect(handed[handed.length - 1]).toEqual({ en: { 'tags.viewer.title': 'Pheromones' } })
  })

  it('beehive is a theme you can choose', async () => {
    const { theme } = await load('honey')
    expect(theme.themes).toContain('beehive')
  })
})

describe('the shipped vocabulary', () => {
  const locales = readdirSync(i18nDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))

  it('no default catalog calls anything a pheromone — that word is for /deposit', () => {
    for (const locale of locales) {
      const said = Object.entries(catalog(locale)).filter(([, value]) => PHEROMONE.test(value)).map(([key]) => key)
      expect(said, locale).toEqual([])
    }
  })

  it('the beehive words keep the hive wording for every locale, keyed to strings that exist', () => {
    expect(Object.keys(beehive).sort()).toEqual([...locales].sort())
    for (const locale of locales) {
      const shipped = catalog(locale)
      for (const key of Object.keys(beehive[locale])) expect(shipped, `${locale} ${key}`).toHaveProperty(key)
    }
    expect(beehive.en['tags.viewer.title']).toBe('Pheromones')
    expect(beehive.ja['tags.viewer.title']).toBe('フェロモン')
  })

  it('the theme word registers them as the beehive theme', () => {
    const queen = readFileSync(join(root, 'hypercomb-essentials', 'src', 'commands', 'theme.queen.ts'), 'utf8')
    expect(queen).toContain("import BEEHIVE_WORDS from './beehive.words.json'")
    expect(queen).toContain("theme.registerThemeWords?.('beehive', BEEHIVE_WORDS)")
  })
})
