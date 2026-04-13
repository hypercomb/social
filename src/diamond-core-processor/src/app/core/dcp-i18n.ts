// dcp-i18n.ts — lightweight i18n bootstrap for Diamond Core Processor
//
// Registers LocalizationService and loads all 14 locale catalogs so
// DCP templates can use the same TranslatePipe as the main web shell.

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

// ─── minimal i18n service ────────────────────────────────────────────────────
// DCP needs its own LocalizationService instance since it runs on a
// separate Angular app. This mirrors the shared service interface.

class DcpLocalizationService extends EventTarget implements I18nProvider {
  #locale: string
  #catalogs = new Map<string, Map<string, Record<string, string>>>()
  #overrides = new Map<string, Map<string, Record<string, string>>>()

  constructor() {
    super()
    this.#locale =
      localStorage.getItem('hc:locale') ??
      navigator.language?.slice(0, 2) ??
      'en'
    document.documentElement.lang = this.#locale
  }

  get locale(): string { return this.#locale }

  setLocale(locale: string): void {
    if (locale === this.#locale) return
    this.#locale = locale
    localStorage.setItem('hc:locale', locale)
    document.documentElement.lang = locale
    this.dispatchEvent(new CustomEvent('change'))
  }

  registerTranslations(namespace: string, locale: string, catalog: Record<string, string>): void {
    if (!this.#catalogs.has(namespace)) this.#catalogs.set(namespace, new Map())
    const ns = this.#catalogs.get(namespace)!
    const existing = ns.get(locale)
    ns.set(locale, existing ? Object.assign(existing, catalog) : catalog)
    this.dispatchEvent(new CustomEvent('change'))
  }

  registerOverrides(namespace: string, locale: string, catalog: Record<string, string>): void {
    if (!this.#overrides.has(namespace)) this.#overrides.set(namespace, new Map())
    const ns = this.#overrides.get(namespace)!
    const existing = ns.get(locale)
    ns.set(locale, existing ? Object.assign(existing, catalog) : catalog)
    this.dispatchEvent(new CustomEvent('change'))
  }

  resolveCell(directoryName: string, namespace = 'app'): string {
    return this.t(`cell.${directoryName}`, undefined, namespace) === `cell.${directoryName}`
      ? directoryName
      : this.t(`cell.${directoryName}`, undefined, namespace)
  }

  t(key: string, params?: Record<string, string | number>, namespace = 'app'): string {
    const override = this.#overrides.get(namespace)?.get(this.#locale)?.[key]
      ?? this.#overrides.get(namespace)?.get('en')?.[key]
    if (override) {
      let out = override
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
        }
      }
      return out
    }

    const ns = this.#catalogs.get(namespace)
    if (!ns) return key
    const catalog = ns.get(this.#locale) ?? ns.get('en')
    if (!catalog) return key

    let text: string | undefined
    if (params && typeof params['count'] === 'number') {
      if (params['count'] === 0) text = catalog[`${key}.zero`]
      else if (params['count'] === 1) text = catalog[`${key}.one`]
      text ??= catalog[`${key}.other`]
    }
    text ??= catalog[key]
    if (!text) return key

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return text
  }
}

// ─── bootstrap ───────────────────────────────────────────────────────────────

let initialized = false

export async function initDcpI18n(): Promise<void> {
  if (initialized) return
  initialized = true

  const i18n = new DcpLocalizationService()
  ;(window as any).ioc.register(I18N_IOC_KEY, i18n)

  try {
    const [
      en, ja, zh, es, ar, pt, fr, de, ko, ru, hi, id, tr, it
    ] = await Promise.all([
      import('../../../../hypercomb-shared/i18n/en.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/ja.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/zh.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/es.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/ar.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/pt.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/fr.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/de.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/ko.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/ru.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/hi.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/id.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/tr.json', { with: { type: 'json' } }),
      import('../../../../hypercomb-shared/i18n/it.json', { with: { type: 'json' } }),
    ])
    i18n.registerTranslations('app', 'en', en.default)
    i18n.registerTranslations('app', 'ja', ja.default)
    i18n.registerTranslations('app', 'zh', zh.default)
    i18n.registerTranslations('app', 'es', es.default)
    i18n.registerTranslations('app', 'ar', ar.default)
    i18n.registerTranslations('app', 'pt', pt.default)
    i18n.registerTranslations('app', 'fr', fr.default)
    i18n.registerTranslations('app', 'de', de.default)
    i18n.registerTranslations('app', 'ko', ko.default)
    i18n.registerTranslations('app', 'ru', ru.default)
    i18n.registerTranslations('app', 'hi', hi.default)
    i18n.registerTranslations('app', 'id', id.default)
    i18n.registerTranslations('app', 'tr', tr.default)
    i18n.registerTranslations('app', 'it', it.default)
  } catch { /* translations are best-effort */ }
}
