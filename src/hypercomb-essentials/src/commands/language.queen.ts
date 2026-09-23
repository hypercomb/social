// commands/language.queen.ts
//
// THE LANGUAGE IS THE COMMUNITY'S (documentation/community-translations.md;
// jwize 2026-09-23: "the community be responsible for the language so they
// can also be colon:keyed … notify those where languages are missing … heal
// and replicate for subscribers"). The words:
//
//   language                        the current locale
//   language <locale>               switch the UI (14 shipped catalogs)
//   language offer [<locale>] [@<host>]
//                                   YOUR OWN translations for the locale — the
//                                   override layer `i18n-override` writes —
//                                   become a signed catalog on the host, named
//                                   in your index as i18n:<locale>. Anyone who
//                                   syncs that locale from the host heals with
//                                   them. Never a judgment: Jev is not asked.
//   language sync [<locale>] [@<host>]
//                                   ask the hosts you follow (and @<host>) for
//                                   catalogs of the locale, verify each against
//                                   its signature, and HEAL — only keys the
//                                   locale lacks are filled, never a shipped
//                                   string replaced; your overrides stay on
//                                   top. What was placed is kept in this hive's
//                                   translations pool and re-applied at boot.
//   language missing [<locale>] [@<host>]
//                                   the keys this session resolved through the
//                                   fallback; with a host, published under your
//                                   key as i18n-missing:<locale>, so a translator
//                                   sees the demand.
//
// The three publishing words are the participant's alone. (`offer`, not
// `publish`: the command line runs every behaviour word on a line in order,
// and `publish` is a word of its own.)

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { setHiveRoot } from '../sharing/hive-pointer.js'
import { PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'
import { listCommunityHosts } from '../sharing/community-hosts.js'
import {
  catalogOf, cleanLocale, COMMUNITY_SUBKEY, healFrom, mergeCatalogs, publishCatalog, publishMissing,
  readCatalog, readTranslationIndex, type CatalogRecord, type HealingProvider, type PublishDeps,
} from '../sharing/community-translations.js'

const LOCALES = ['en', 'ja', 'zh', 'es', 'ar', 'pt', 'fr', 'de', 'ko', 'ru', 'hi', 'id', 'tr', 'it']
const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
/** Catalogs read per host per sync — a curated list, not a dump. */
const CATALOGS_PER_HOST = 64
const SAMPLE = 6

type StoreLike = {
  overrides?: FileSystemDirectoryHandle
  translations?: FileSystemDirectoryHandle
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
  getPoolDoc?(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc?(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
}
type HostSyncLike = {
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}
type Say = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** A host as a URL: loopback on http, everything else https. */
const hostUrl = (host: string): string => {
  const bare = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const loopback = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(:\d{1,5})?$/i.test(bare)
  return `${loopback ? 'http' : 'https'}://${bare}`
}

const provider = (): (I18nProvider & HealingProvider) | undefined => window.ioc?.get?.(I18N_IOC_KEY) as (I18nProvider & HealingProvider) | undefined
const store = (): StoreLike | undefined => window.ioc?.get?.(STORE_KEY) as StoreLike | undefined

/** What this hive publishes with: its store to put, its host service to ship, its key to stamp. */
const publishDeps = (host: string): PublishDeps | null => {
  const s = store()
  const sync = window.ioc?.get?.(HOST_SYNC_KEY) as HostSyncLike | undefined
  const putResource = s?.putResource?.bind(s)
  const publishAtoms = sync?.publishAtoms?.bind(sync)
  if (!putResource || !publishAtoms) return null
  const bytesOf = async (sig: string): Promise<Uint8Array | null> => {
    const blob = await (s?.getResourceLocal?.(sig).catch(() => null) ?? Promise.resolve(null)) ?? await (s?.getResource?.(sig).catch(() => null) ?? Promise.resolve(null))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  return {
    put: (text, type) => putResource(new Blob([text], { type }), { emit: false }),
    publish: async (h, sigs) => { const done = await publishAtoms(h, sigs, bytesOf); return done.ok ? { ok: true } : { ok: false, error: done.error } },
    stamp: (h, key, sig) => setHiveRoot(h, key, sig),
    now: Date.now,
  }
}

/** This hive's own override layer for a locale — what `i18n-override` wrote. */
const ownOverrides = async (locale: string): Promise<Record<string, string>> => {
  const s = store()
  if (!s?.overrides || !s.getPoolDoc) return {}
  try {
    // The override word writes the layer into the pool's i18n sub-bucket; the pool root is the older spelling.
    const bytes = (await s.getPoolDoc(s.overrides, 'i18n')) ?? (await s.getPoolDoc(s.overrides))
    if (!bytes) return {}
    const layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, Record<string, string>>
    const own = layer?.[locale]
    return own && typeof own === 'object' ? own : {}
  } catch { return {} }
}

/** What this hive placed for a locale, kept in its translations pool. */
const placed = async (locale: string): Promise<CatalogRecord | null> => {
  const s = store()
  if (!s?.translations || !s.getPoolDoc) return null
  try {
    const bytes = await s.getPoolDoc(s.translations, COMMUNITY_SUBKEY(locale))
    return bytes ? catalogOf(JSON.parse(new TextDecoder().decode(bytes))) : null
  } catch { return null }
}
const keep = async (catalog: CatalogRecord): Promise<void> => {
  const s = store()
  if (!s?.translations || !s.putPoolDoc) return
  try { await s.putPoolDoc(s.translations, new TextEncoder().encode(JSON.stringify(catalog)).buffer as ArrayBuffer, COMMUNITY_SUBKEY(catalog.locale)) } catch { /* kept next time */ }
}

/** AT BOOT AND ON EVERY LOCALE CHANGE: what was placed heals the provider again. */
export const healFromPool = async (locale: string): Promise<string[]> => {
  const i18n = provider()
  if (!i18n) return []
  const catalog = await placed(locale)
  return catalog ? healFrom(i18n, catalog) : []
}

export class LanguageQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'language'
  override description = 'Switch the UI language; publish, sync or report the community\'s translations'
  override descriptionKey = 'slash.language'
  override options = [...LOCALES, 'offer [<locale>] [@<host>]', 'sync [<locale>] [@<host>]', 'missing [<locale>] [@<host>]']
  override examples = [
    { input: '/language ja', result: 'UI switches to Japanese' },
    { input: '/language sync ja', result: 'Heals the Japanese UI with catalogs the hosts you follow publish' },
    { input: '/language offer ja', result: 'Your own Japanese translations become a signed catalog on the host' },
  ]
  override machine = {
    forms: 'language | language <locale>',
    example: '/language ja',
    bare: true,
    reach: 'editing' as const,
    scope: 'local' as const,
    refuse: (args: string): string | undefined => {
      const [word = ''] = args.trim().toLowerCase().split(/\s+/)
      return ['offer', 'sync', 'missing'].includes(word) ? `/language ${word} publishes or places under the participant's key; only the participant says it` : undefined
    },
  }

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    const all = [...LOCALES, 'offer ', 'sync ', 'missing ']
    if (!q) return all
    return all.filter(l => l.startsWith(q) && l.trim() !== q)
  }

  protected async execute(args: string): Promise<void> {
    const i18n = provider()
    const t: Say = (key, fallback, params) => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    }
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    if (!i18n) { toast(t('language.unavailable', 'The localization service is not available here.'), 'warning'); return }

    const parts = args.trim().split(/\s+/).filter(Boolean)
    const [word = ''] = parts
    if (!word) { toast(t('language.current', 'The language is {locale}.', { locale: i18n.locale })); return }

    if (!['offer', 'sync', 'missing'].includes(word.toLowerCase())) {
      const locale = LOCALE_ALIASES[word.toLowerCase()] ?? word.toLowerCase()
      i18n.setLocale(locale)
      toast(t('language.set', 'The language is now {locale}.', { locale }))
      return
    }

    const host = parts.find(p => p.startsWith('@'))?.slice(1) || (PUBLIC_CONTENT_HOSTS[0] ?? '')
    const named = parts.slice(1).find(p => !p.startsWith('@'))
    const locale = cleanLocale(named ? (LOCALE_ALIASES[named.toLowerCase()] ?? named) : i18n.locale)
    if (!locale) { toast(t('language.badlocale', 'Say a locale like ja, zh or es.'), 'warning'); return }

    if (word === 'offer') {
      const keys = await ownOverrides(locale)
      if (!Object.keys(keys).length) { toast(t('language.nooverrides', 'Nothing to publish: you have no {locale} translations of your own yet — say i18n-override {locale} <key> <text> first.', { locale }), 'warning'); return }
      const deps = host ? publishDeps(host) : null
      if (!deps) { toast(t('language.unpublished', 'Your {locale} translations were not published: {reason}', { locale, reason: host ? 'the store or the host service is not loaded' : 'no host is configured' }), 'warning'); return }
      const done = await publishCatalog(host, locale, 'app', keys, deps)
      if (!done.ok) { toast(t('language.unpublished', 'Your {locale} translations were not published: {reason}', { locale, reason: done.error }), 'warning'); return }
      toast(t('language.published', 'Published {count} {locale} translations under your key to {host}; anyone who syncs {locale} from there can heal with them.', { count: Object.keys(done.record.keys).length, locale, host }), 'success')
      EffectBus.emit('language:published', { locale, host, catalog: done.sig, count: Object.keys(done.record.keys).length })
      return
    }

    if (word === 'sync') {
      const hosts = [...new Set([...(parts.some(p => p.startsWith('@')) ? [host] : []), ...PUBLIC_CONTENT_HOSTS, ...(await listCommunityHosts().catch(() => []))].filter(Boolean))]
      let merged = await placed(locale)
      const filled = new Set<string>()
      const translators = new Set<string>()
      let answered = 0
      for (const h of hosts) {
        const zone = hostUrl(h)
        const index = await readTranslationIndex(zone, locale)
        if (!index) continue
        answered++
        for (const sig of index.members.slice(0, CATALOGS_PER_HOST)) {
          const catalog = await readCatalog(zone, sig)
          if (!catalog || catalog.locale !== locale) continue
          translators.add(index.translators.find(tr => tr.catalog === sig)?.pubkey ?? sig)
          for (const key of healFrom(i18n, catalog)) filled.add(key)
          merged = mergeCatalogs(merged, catalog)
        }
      }
      if (merged) await keep(merged)
      if (!translators.size) { toast(t('language.nosync', 'No {locale} translations found on {hosts} hosts.', { locale, hosts: answered }), 'warning'); return }
      toast(t('language.synced', 'Synced {locale}: {filled} missing translations healed from {translators} translators on {hosts} hosts.', { locale, filled: filled.size, translators: translators.size, hosts: answered }), 'success')
      EffectBus.emit('language:synced', { locale, filled: [...filled], translators: [...translators], hosts: answered })
      return
    }

    // missing
    const keys = (i18n.missingKeys?.(locale) ?? []).sort()
    if (!keys.length) { toast(t('language.missingnone', 'Nothing is missing in {locale} this session.', { locale })); return }
    toast(t('language.missingcount', '{count} keys have no {locale} translation this session: {sample}', { count: keys.length, locale, sample: keys.slice(0, SAMPLE).join(', ') + (keys.length > SAMPLE ? ', …' : '') }))
    if (!parts.some(p => p.startsWith('@')) && !PUBLIC_CONTENT_HOSTS[0]) return
    const deps = host ? publishDeps(host) : null
    if (!deps) { toast(t('language.missingunsent', 'The missing list was not published: {reason}', { reason: 'the store or the host service is not loaded' }), 'warning'); return }
    const sent = await publishMissing(host, locale, keys, deps)
    if (!sent.ok) { toast(t('language.missingunsent', 'The missing list was not published: {reason}', { reason: sent.error }), 'warning'); return }
    toast(t('language.missingsent', 'Told {host} which {count} keys {locale} lacks, under your key.', { host, count: keys.length, locale }), 'success')
    EffectBus.emit('language:missing', { locale, host, record: sent.sig, count: keys.length })
  }
}

/** Map common aliases to canonical locale codes. */
const LOCALE_ALIASES: Record<string, string> = {
  'jp': 'ja', 'japanese': 'ja', 'cn': 'zh', 'chinese': 'zh', 'spanish': 'es', 'arabic': 'ar', 'portuguese': 'pt', 'br': 'pt',
  'french': 'fr', 'german': 'de', 'korean': 'ko', 'kr': 'ko', 'russian': 'ru', 'hindi': 'hi', 'indonesian': 'id', 'turkish': 'tr',
  'italian': 'it', 'en-us': 'en',
}

const _language = new LanguageQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LanguageQueenBee', _language)

// WHAT WAS PLACED HEALS AGAIN: once the store and the provider are up, and on
// every locale change. Reading never mints — a hive that placed nothing has
// no document and nothing happens.
window.ioc?.whenReady?.(STORE_KEY, () => {
  window.ioc?.whenReady?.(I18N_IOC_KEY, () => {
    const i18n = provider()
    if (i18n) void healFromPool(i18n.locale)
  })
})
EffectBus.on<{ locale?: string }>('locale:changed', payload => {
  const locale = cleanLocale(payload?.locale)
  if (locale) void healFromPool(locale)
})
