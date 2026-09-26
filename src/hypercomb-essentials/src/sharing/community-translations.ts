// sharing/community-translations.ts
//
// THE COMMUNITY IS RESPONSIBLE FOR THE LANGUAGE (jwize, 2026-09-23): "so they
// can also be colon:keyed. We find by convention and maybe notify those where
// languages are missing to add a translation to their host. That way it can
// heal and replicate for subscribers."
//
// A translation is a person's work under their own key, never a judgment:
//
//   - A TRANSLATOR publishes a catalog — `{ kind: 'i18n-catalog', locale,
//     namespace, keys }`, a resource on the host — and names it in their OWN
//     signed index as `i18n:<locale>`. The signature on the index is the
//     signature on the catalog, exactly as an assessment is signed.
//   - A HOST lists every verified catalog for a locale at the pool's derived
//     address `sign('i18n:<locale>')` — the same one-file index every published
//     pool uses (published-pools.ts). There is no named route.
//     No registry: a hive computes the address and asks.
//   - A SUBSCRIBER'S `language sync` probes the hosts it follows, verifies each
//     catalog against its signature, and HEALS: only keys its locale lacks are
//     filled, never a shipped string replaced, and the participant's own
//     overrides stay on top. What was placed is kept in the hive's own
//     translations pool, so the healing survives a reload and a lost host.
//   - A hive that still lacks keys says so under its key: `language missing`
//     publishes `{ kind: 'i18n-missing', locale, keys }` as `i18n-missing:
//     <locale>`, and the host lists who is missing what, so a translator sees
//     the demand. Nothing is sent without that word.
//
// Data never heals destructively: the shipped catalogs remain the walk-back,
// a catalog is additive, and the merged record is a document replaced whole.

import { SignatureService, registerPoolMeaning } from '@hypercomb/core'

export const I18N_KEY_PREFIX = 'i18n:'
export const I18N_MISSING_PREFIX = 'i18n-missing:'
/** Where a hive keeps what it placed: one document per locale in the store's translations pool. */
export const COMMUNITY_SUBKEY = (locale: string): string => `community-${locale}`

const LOCALE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/
const SIG_RE = /^[0-9a-f]{64}$/
/** A catalog is a curated list of strings, not a dump. */
export const CATALOG_KEYS_MAX = 4_000
export const MISSING_KEYS_MAX = 2_000

export interface CatalogRecord {
  readonly kind: 'i18n-catalog'
  readonly locale: string
  readonly namespace: string
  readonly keys: Readonly<Record<string, string>>
  readonly at: number
}
export interface MissingRecord {
  readonly kind: 'i18n-missing'
  readonly locale: string
  readonly keys: readonly string[]
  readonly at: number
}

/** What a host lists for a locale (worker serveTranslations). */
export interface TranslationIndex {
  readonly meaning: string
  readonly locale: string
  readonly members: readonly string[]
  readonly translators: readonly { readonly pubkey: string; readonly label: string; readonly catalog: string; readonly at: number }[]
  readonly missing: readonly { readonly pubkey: string; readonly record: string; readonly keys: readonly string[]; readonly at: number }[]
}

export const cleanLocale = (raw: unknown): string | null => {
  const locale = String(raw ?? '').trim().toLowerCase()
  return LOCALE_RE.test(locale) ? locale : null
}

/** The catalog as it arrives: every field unknown until it is checked. */
export const catalogOf = (raw: unknown): CatalogRecord | null => {
  const record = raw as Partial<CatalogRecord> | null
  if (!record || record.kind !== 'i18n-catalog') return null
  const locale = cleanLocale(record.locale)
  if (!locale) return null
  const namespace = typeof record.namespace === 'string' && /^[a-z0-9.-]{1,64}$/i.test(record.namespace) ? record.namespace : 'app'
  const keys: Record<string, string> = {}
  let count = 0
  for (const [key, value] of Object.entries(record.keys ?? {})) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,120}$/i.test(key) || !value.trim()) continue
    if (++count > CATALOG_KEYS_MAX) break
    keys[key] = value
  }
  if (!count) return null
  return { kind: 'i18n-catalog', locale, namespace, keys, at: Number.isFinite(record.at) ? Number(record.at) : 0 }
}

export const missingOf = (raw: unknown): MissingRecord | null => {
  const record = raw as Partial<MissingRecord> | null
  if (!record || record.kind !== 'i18n-missing') return null
  const locale = cleanLocale(record.locale)
  if (!locale) return null
  const keys = (Array.isArray(record.keys) ? record.keys : []).filter((k): k is string => typeof k === 'string' && /^[a-z0-9][a-z0-9_.-]{0,120}$/i.test(k)).slice(0, MISSING_KEYS_MAX)
  if (!keys.length) return null
  return { kind: 'i18n-missing', locale, keys, at: Number.isFinite(record.at) ? Number(record.at) : 0 }
}

/** The index a host answers, checked field by field; nothing is guessed at. */
export const translationIndexOf = (raw: unknown, locale: string): TranslationIndex => {
  const value = raw as Partial<TranslationIndex> | null
  const sigs = (list: unknown): string[] => (Array.isArray(list) ? list : []).map(s => String(s ?? '').toLowerCase()).filter(s => SIG_RE.test(s))
  const translators = (Array.isArray(value?.translators) ? value!.translators : [])
    .filter(t => t && SIG_RE.test(String(t.pubkey ?? '')) && SIG_RE.test(String(t.catalog ?? '')))
    .map(t => ({ pubkey: String(t.pubkey).toLowerCase(), label: typeof t.label === 'string' ? t.label : '', catalog: String(t.catalog).toLowerCase(), at: Number.isFinite(t.at) ? Number(t.at) : 0 }))
  const missing = (Array.isArray(value?.missing) ? value!.missing : [])
    .filter(m => m && SIG_RE.test(String(m.pubkey ?? '')) && SIG_RE.test(String(m.record ?? '')))
    .map(m => ({ pubkey: String(m.pubkey).toLowerCase(), record: String(m.record).toLowerCase(), keys: (Array.isArray(m.keys) ? m.keys as unknown[] : []).filter((k): k is string => typeof k === 'string').slice(0, MISSING_KEYS_MAX), at: Number.isFinite(m.at) ? Number(m.at) : 0 }))
  return { meaning: `${I18N_KEY_PREFIX}${locale}`, locale, members: sigs(value?.members), translators, missing }
}

// ── the provider, as far as healing needs it ───────────────────────────────

/** The runtime LocalizationService, typed structurally: a module never imports
 *  the shell. `healTranslations` and `missingKeys` are the two doors this
 *  feature added to it (hypercomb-runtime/src/i18n.service.ts). */
export interface HealingProvider {
  readonly locale: string
  t(key: string, params?: Record<string, string | number>, namespace?: string): string
  registerTranslations(namespace: string, locale: string, catalog: Record<string, string>): void
  /** Fill only the keys this locale lacks; returns the keys it filled. */
  healTranslations?(namespace: string, locale: string, catalog: Record<string, string>): string[]
  /** Keys this session resolved through the fallback locale. */
  missingKeys?(locale: string): string[]
}

/** Heal the provider from a catalog: only keys the locale lacks are filled.
 *  Without the healing door, nothing is registered — a plain register would
 *  overwrite shipped strings, which a stranger's catalog must never do. */
export const healFrom = (i18n: HealingProvider, catalog: CatalogRecord): string[] =>
  i18n.healTranslations ? i18n.healTranslations(catalog.namespace, catalog.locale, { ...catalog.keys }) : []

/** Two catalogs for one locale, merged: the later one's keys win, so a
 *  translator's correction replaces their earlier word and never a stranger's. */
export const mergeCatalogs = (into: CatalogRecord | null, catalog: CatalogRecord): CatalogRecord => ({
  kind: 'i18n-catalog', locale: catalog.locale, namespace: catalog.namespace,
  keys: { ...(into?.keys ?? {}), ...catalog.keys }, at: Math.max(into?.at ?? 0, catalog.at),
})

// ── the acts: publish a catalog, publish a missing list ────────────────────

export interface PublishDeps {
  put(text: string, type: string): Promise<string>
  publish(host: string, sigs: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }>
  stamp(host: string, key: string, sig: string): Promise<{ ok: boolean; reason?: string }>
  now(): number
}

/** Put the catalog, ship it to the host, and name it in this hive's index as `i18n:<locale>`. */
export const publishCatalog = async (
  host: string, locale: string, namespace: string, keys: Readonly<Record<string, string>>, deps: PublishDeps,
): Promise<{ ok: true; sig: string; record: CatalogRecord } | { ok: false; error: string }> => {
  const record = catalogOf({ kind: 'i18n-catalog', locale, namespace, keys, at: deps.now() })
  if (!record) return { ok: false, error: 'nothing to publish: no translated keys for that locale' }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  const published = await deps.publish(host, [sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, `${I18N_KEY_PREFIX}${locale}`, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the catalog pointer was not stamped' }
  return { ok: true, sig, record }
}

/** Say, under this hive's key, which keys its locale still lacks. */
export const publishMissing = async (
  host: string, locale: string, keys: readonly string[], deps: PublishDeps,
): Promise<{ ok: true; sig: string; record: MissingRecord } | { ok: false; error: string }> => {
  const record = missingOf({ kind: 'i18n-missing', locale, keys: [...keys].sort(), at: deps.now() })
  if (!record) return { ok: false, error: 'nothing is missing' }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  const published = await deps.publish(host, [sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, `${I18N_MISSING_PREFIX}${locale}`, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the missing pointer was not stamped' }
  return { ok: true, sig, record }
}

// ── the reads: the host's index, a catalog by signature ────────────────────

/** `GET <zone>/<sign('i18n:<locale>')>` — what the host lists for a locale, at
 *  the pool's own address (no named route). */
export const readTranslationIndex = async (zone: string, locale: string): Promise<TranslationIndex | null> => {
  try {
    const pool = await registerPoolMeaning(`${I18N_KEY_PREFIX}${locale}`)
    const res = await fetch(`${zone.replace(/\/+$/, '')}/${pool}`, { cache: 'no-store' })
    if (!res.ok) return null
    return translationIndexOf(await res.json(), locale)
  } catch { return null }
}

/** A catalog from a host, believed only when its bytes hash to the signature asked for. */
export const readCatalog = async (zone: string, sig: string): Promise<CatalogRecord | null> => {
  try {
    const res = await fetch(`${zone.replace(/\/+$/, '')}/${sig}`, { cache: 'force-cache' })
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    if ((await SignatureService.sign(bytes)) !== sig) return null
    return catalogOf(JSON.parse(new TextDecoder().decode(bytes)))
  } catch { return null }
}
