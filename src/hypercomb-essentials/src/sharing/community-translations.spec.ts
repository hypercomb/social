// community-translations.spec.ts — a translation is a person's work under
// their own key: published as a catalog, listed by the host, healed into a
// subscriber's locale without ever replacing a shipped string.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { catalogOf, healFrom, mergeCatalogs, missingOf, publishCatalog, publishMissing, translationIndexOf, type HealingProvider, type PublishDeps } from './community-translations.js'

const world = () => {
  const heap = new Map<string, string>()
  const published: string[][] = []
  const stamped: [string, string][] = []
  const deps: PublishDeps = {
    put: async text => { const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer); heap.set(sig, text); return sig },
    publish: async (_host, sigs) => { published.push([...sigs]); return { ok: true } },
    stamp: async (_host, key, sig) => { stamped.push([key, sig]); return { ok: true } },
    now: () => 1_700_000_000_000,
  }
  return { heap, deps, published, stamped }
}

/** A provider with a shipped catalog and the healing door. */
const provider = (shipped: Record<string, Record<string, string>>) => {
  const catalogs: Record<string, Record<string, string>> = Object.fromEntries(Object.entries(shipped).map(([l, c]) => [l, { ...c }]))
  const p: HealingProvider = {
    locale: 'ja',
    t: key => catalogs['ja']?.[key] ?? catalogs['en']?.[key] ?? key,
    registerTranslations: (_ns, locale, catalog) => { catalogs[locale] = { ...(catalogs[locale] ?? {}), ...catalog } },
    healTranslations: (_ns, locale, catalog) => {
      const have = catalogs[locale] ?? (catalogs[locale] = {})
      const filled: string[] = []
      for (const [key, value] of Object.entries(catalog)) if (have[key] === undefined) { have[key] = value; filled.push(key) }
      return filled
    },
    missingKeys: () => [],
  }
  return { p, catalogs }
}

describe('a catalog', () => {
  it('is checked field by field: a bad locale, a bad key or an empty catalog is refused', () => {
    expect(catalogOf({ kind: 'i18n-catalog', locale: 'ja', keys: { 'module.jevfollows': 'すべての規則に従う', 'bad key!': 'x', empty: '  ' } }))
      .toEqual({ kind: 'i18n-catalog', locale: 'ja', namespace: 'app', keys: { 'module.jevfollows': 'すべての規則に従う' }, at: 0 })
    expect(catalogOf({ kind: 'i18n-catalog', locale: 'Japanese', keys: { a: 'b' } })).toBeNull()
    expect(catalogOf({ kind: 'i18n-catalog', locale: 'ja', keys: {} })).toBeNull()
    expect(catalogOf({ kind: 'other', locale: 'ja', keys: { a: 'b' } })).toBeNull()
    expect(missingOf({ kind: 'i18n-missing', locale: 'ja', keys: ['module.jevread', 7, 'bad key!'] })).toEqual({ kind: 'i18n-missing', locale: 'ja', keys: ['module.jevread'], at: 0 })
  })

  it('is published under the translator\'s key: put, shipped, stamped i18n:<locale>', async () => {
    const w = world()
    const done = await publishCatalog('h', 'ja', 'app', { 'module.jevfollows': 'すべての規則に従う' }, w.deps)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(JSON.parse(w.heap.get(done.sig)!)).toMatchObject({ kind: 'i18n-catalog', locale: 'ja', namespace: 'app', at: 1_700_000_000_000 })
    expect(w.published.at(-1)).toEqual([done.sig])
    expect(w.stamped.at(-1)).toEqual(['i18n:ja', done.sig])
    expect(await publishCatalog('h', 'ja', 'app', {}, w.deps)).toEqual({ ok: false, error: 'nothing to publish: no translated keys for that locale' })
    const missing = await publishMissing('h', 'ja', ['module.jevread', 'module.focuson'], w.deps)
    expect(missing.ok && w.stamped.at(-1)).toEqual(['i18n-missing:ja', missing.ok ? missing.sig : ''])
  })

  it('heals only what the locale lacks — a shipped string is never replaced, and the override layer is not touched', () => {
    const { p, catalogs } = provider({ en: { 'module.jevread': 'Jev read {name}', 'editor.save': 'Save' }, ja: { 'editor.save': '保存' } })
    const catalog = catalogOf({ kind: 'i18n-catalog', locale: 'ja', keys: { 'module.jevread': 'Jevが{name}を読みました', 'editor.save': 'セーブ' } })!
    expect(healFrom(p, catalog)).toEqual(['module.jevread'])
    expect(catalogs['ja']).toEqual({ 'editor.save': '保存', 'module.jevread': 'Jevが{name}を読みました' })
    expect(p.t('module.jevread')).toBe('Jevが{name}を読みました')
    // Without the healing door nothing is registered at all.
    const plain: HealingProvider = { locale: 'ja', t: k => k, registerTranslations: () => { throw new Error('must not be called') } }
    expect(healFrom(plain, catalog)).toEqual([])
  })

  it('merges two catalogs for one locale, the later one\'s keys winning', () => {
    const a = catalogOf({ kind: 'i18n-catalog', locale: 'ja', keys: { x: '1', y: '1' }, at: 1 })!
    const b = catalogOf({ kind: 'i18n-catalog', locale: 'ja', keys: { y: '2', z: '2' }, at: 2 })!
    expect(mergeCatalogs(a, b)).toEqual({ kind: 'i18n-catalog', locale: 'ja', namespace: 'app', keys: { x: '1', y: '2', z: '2' }, at: 2 })
    expect(mergeCatalogs(null, a)).toEqual(a)
  })

  it('reads a host\'s index strictly: only signatures and well-formed translators and missing lists survive', () => {
    const index = translationIndexOf({
      members: ['A'.repeat(64), 'nope'],
      translators: [{ pubkey: 'b'.repeat(64), label: 'Aiko', catalog: 'a'.repeat(64), at: 5 }, { pubkey: 'x' }],
      missing: [{ pubkey: 'c'.repeat(64), record: 'd'.repeat(64), keys: ['module.jevread', 3], at: 6 }],
    }, 'ja')
    expect(index).toEqual({
      meaning: 'i18n:ja', locale: 'ja', members: ['a'.repeat(64)],
      translators: [{ pubkey: 'b'.repeat(64), label: 'Aiko', catalog: 'a'.repeat(64), at: 5 }],
      missing: [{ pubkey: 'c'.repeat(64), record: 'd'.repeat(64), keys: ['module.jevread'], at: 6 }],
    })
  })
})
