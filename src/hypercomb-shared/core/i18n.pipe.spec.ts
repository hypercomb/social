// hypercomb-shared/core/i18n.pipe.spec.ts — THE SHELL DOES NOT RE-TRANSLATE
// ITSELF ON EVERY PASS.
//
// The `| t` pipe is impure (an Angular pure pipe is memoized on its inputs
// alone and would never re-run for `{{ 'key' | t }}` when the locale flips —
// see i18n.pipe.ts), so it IS asked on every pass of a view that shows words.
// What this spec pins down is that being asked costs nothing: one lookup per
// binding per catalog version, the flip landing in the tick AFTER the write
// (the NG0100 rule), and `/language ja` or a late catalog still flipping every
// word.

import { describe, expect, it, vi } from 'vitest'

type Globals = typeof globalThis & {
  register?: (key: string, value: unknown) => void
  get?: (key: string) => unknown
}
const registry = new Map<string, unknown>()
;(globalThis as Globals).register = (key, value) => { registry.set(key, value) }
;(globalThis as Globals).get = (key) => registry.get(key)

/** Past the service's deferred 'change' AND fromRuntime's deferred set. */
const nextTick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const load = async () => {
  vi.resetModules()
  registry.clear()
  localStorage.clear()
  localStorage.setItem('hc:locale', 'en')
  const { LocalizationService } = await import('../../hypercomb-runtime/src/i18n.service')
  const i18n = registry.get('@hypercomb.social/I18n') as InstanceType<typeof LocalizationService>
  const { TranslatePipe, translateStats } = await import('./i18n.pipe')
  i18n.registerTranslations('app', 'en', { 'editor.save': 'Save', 'activity.pasted.one': 'pasted one', 'activity.pasted.other': 'pasted {count}' })
  i18n.registerTranslations('app', 'ja', { 'editor.save': '保存' })
  await nextTick()
  return { i18n, TranslatePipe, stats: translateStats }
}

describe('the catalog version', () => {
  it('moves synchronously with every write that can change a word', async () => {
    const { i18n } = await load()
    const before = i18n.version
    i18n.setLocale('ja');                                        expect(i18n.version).toBe(before + 1)
    i18n.setLocale('ja');                                        expect(i18n.version).toBe(before + 1)   // same locale: no write
    i18n.registerTranslations('x.com', 'en', { a: 'A' });        expect(i18n.version).toBe(before + 2)
    i18n.registerOverrides('app', 'en', { 'editor.save': 'Keep' }); expect(i18n.version).toBe(before + 3)
    i18n.setThemeWords({ en: { 'editor.save': 'Stash' } });      expect(i18n.version).toBe(before + 4)
    expect(i18n.healTranslations('app', 'ja', { 'editor.open': '開く' })).toEqual(['editor.open'])
    expect(i18n.version).toBe(before + 5)
    expect(i18n.healTranslations('app', 'ja', { 'editor.open': 'again' })).toEqual([])   // nothing lacked: no write
    expect(i18n.version).toBe(before + 5)
  })
})

describe('the | t pipe', () => {
  it('answers 1,400 passes that changed no word with one lookup', async () => {
    const { TranslatePipe, stats } = await load()
    const pipe = new TranslatePipe()
    const lookups = stats.lookups
    for (let pass = 0; pass < 1400; pass++) expect(pipe.transform('editor.save')).toBe('Save')
    expect(stats.lookups - lookups).toBe(1)
  })

  it('flips on /language ja — in the tick after the write, never inside it', async () => {
    const { i18n, TranslatePipe, stats } = await load()
    const pipe = new TranslatePipe()
    expect(pipe.transform('editor.save')).toBe('Save')
    i18n.setLocale('ja')
    // The pass that is running when the locale is written sees what it saw:
    // a word that flipped mid-pass is exactly what NG0100 reports.
    expect(pipe.transform('editor.save')).toBe('Save')
    await nextTick()
    const lookups = stats.lookups
    expect(pipe.transform('editor.save')).toBe('保存')
    expect(pipe.transform('editor.save')).toBe('保存')
    expect(stats.lookups - lookups).toBe(1)
  })

  it('flips when a catalog lands late, and when an override shadows a word', async () => {
    const { i18n, TranslatePipe } = await load()
    const pipe = new TranslatePipe()
    expect(pipe.transform('greeting', undefined, 'late.com')).toBe('greeting')
    i18n.registerTranslations('late.com', 'en', { greeting: 'Hello' })
    await nextTick()
    expect(pipe.transform('greeting', undefined, 'late.com')).toBe('Hello')
    i18n.registerOverrides('late.com', 'en', { greeting: 'Howdy' })
    await nextTick()
    expect(pipe.transform('greeting', undefined, 'late.com')).toBe('Howdy')
  })

  it('re-resolves when the inputs change, and only then', async () => {
    const { TranslatePipe, stats } = await load()
    const pipe = new TranslatePipe()
    const one = { count: 1 }
    const lookups = stats.lookups
    expect(pipe.transform('activity.pasted', one)).toBe('pasted one')
    expect(pipe.transform('activity.pasted', one)).toBe('pasted one')       // same params object (Angular's own literal memo)
    expect(stats.lookups - lookups).toBe(1)
    expect(pipe.transform('activity.pasted', { count: 3 })).toBe('pasted 3')
    expect(pipe.transform('editor.save')).toBe('Save')
    expect(stats.lookups - lookups).toBe(3)
  })

  it('shows the key, and keeps asking, while the service is not there yet', async () => {
    vi.resetModules()
    registry.clear()
    const { TranslatePipe } = await import('./i18n.pipe')
    const pipe = new TranslatePipe()
    expect(pipe.transform('editor.save')).toBe('editor.save')
    const { LocalizationService } = await import('../../hypercomb-runtime/src/i18n.service')
    const i18n = registry.get('@hypercomb.social/I18n') as InstanceType<typeof LocalizationService>
    i18n.setLocale('en')
    i18n.registerTranslations('app', 'en', { 'editor.save': 'Save' })
    await nextTick()
    expect(pipe.transform('editor.save')).toBe('Save')
  })
})
