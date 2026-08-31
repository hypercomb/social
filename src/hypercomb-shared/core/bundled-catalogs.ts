// hypercomb-shared/core/bundled-catalogs.ts
//
// The shipped locale catalogs, as a resolver.
//
// These used to be a static map inside `runtime-initializer`, which is now in
// `@hypercomb/runtime` — a package that cannot reach `hypercomb-shared/i18n/`
// and should not want to. A locale is CONTENT: bytes a host holds, fetched
// when needed and verified against their own name. The shim resolves them that
// way (`hypercomb-shim/src/locales.ts`).
//
// Web and dev still bundle them, and this file is where that choice now lives —
// visible, and one line from being replaced by the signature resolver. Angular
// code-splits these into lazy chunks, so bundling costs those shells far less
// than it cost the shim (which inlined all 2.9 MB into its entry).
//
// Adding a language is a line here AND a file in `../i18n/`. That is exactly
// the friction the content model removes.

/** locale → catalog, or null when this build ships no such language. */
export const bundledCatalogs = async (locale: string): Promise<Record<string, string> | null> => {
  const loaders: Record<string, () => Promise<{ default: Record<string, string> }>> = {
    en: () => import('../i18n/en.json', { with: { type: 'json' } }),
    ja: () => import('../i18n/ja.json', { with: { type: 'json' } }),
    zh: () => import('../i18n/zh.json', { with: { type: 'json' } }),
    es: () => import('../i18n/es.json', { with: { type: 'json' } }),
    ar: () => import('../i18n/ar.json', { with: { type: 'json' } }),
    pt: () => import('../i18n/pt.json', { with: { type: 'json' } }),
    fr: () => import('../i18n/fr.json', { with: { type: 'json' } }),
    de: () => import('../i18n/de.json', { with: { type: 'json' } }),
    ko: () => import('../i18n/ko.json', { with: { type: 'json' } }),
    ru: () => import('../i18n/ru.json', { with: { type: 'json' } }),
    hi: () => import('../i18n/hi.json', { with: { type: 'json' } }),
    id: () => import('../i18n/id.json', { with: { type: 'json' } }),
    tr: () => import('../i18n/tr.json', { with: { type: 'json' } }),
    it: () => import('../i18n/it.json', { with: { type: 'json' } }),
  }
  const loader = loaders[locale]
  if (!loader) return null
  try {
    return (await loader()).default
  } catch {
    return null   // absent catalog — the loader degrades exactly as before
  }
}

/** Every locale this build ships. The runtime asks for this so its idle sweep
 *  can warm the rest after first paint, which is what the old static map's
 *  `Object.keys()` did. */
export const bundledLocales = (): string[] =>
  ['en', 'ja', 'zh', 'es', 'ar', 'pt', 'fr', 'de', 'ko', 'ru', 'hi', 'id', 'tr', 'it']
