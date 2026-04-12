// hypercomb-shared/core/i18n.service.ts
//
// Runtime localization service. Extends EventTarget so Angular components can
// bridge to signals via fromRuntime(). Bees resolve via window.ioc.get(I18N_IOC_KEY).
//
// Translation catalogs are namespace-scoped: the host app uses 'app', community
// modules register under their own namespace (e.g., 'revolucionstyle.com').
//
// Pluralization: when params.count is present, looks for key.zero / key.one / key.other
// before falling back to the base key.
//
// Interpolation: replaces {token} placeholders with params[token].

import { EffectBus } from '@hypercomb/core'
import type { I18nProvider } from '@hypercomb/core'

const STORAGE_KEY = 'hc:locale'
const FALLBACK_LOCALE = 'en'

export class LocalizationService extends EventTarget implements I18nProvider {

  // namespace → locale → flat-key → translated string
  #catalogs = new Map<string, Map<string, Record<string, string>>>()
  // override layer — checked before #catalogs, lets users/community shadow bee translations
  #overrides = new Map<string, Map<string, Record<string, string>>>()
  #locale: string
  #fallback = FALLBACK_LOCALE

  constructor() {
    super()

    // Detect initial locale: user preference → browser → fallback
    const stored = localStorage.getItem(STORAGE_KEY)
    const browser = navigator.language?.split('-')[0] ?? FALLBACK_LOCALE
    this.#locale = stored ?? browser

    document.documentElement.lang = this.#locale
  }

  // -----------------------------------------------
  // I18nProvider interface
  // -----------------------------------------------

  get locale(): string {
    return this.#locale
  }

  setLocale(locale: string): void {
    if (this.#locale === locale) return
    this.#locale = locale
    localStorage.setItem(STORAGE_KEY, locale)
    document.documentElement.lang = locale
    EffectBus.emit('locale:changed', { locale })
    this.dispatchEvent(new CustomEvent('change'))
  }

  registerTranslations(namespace: string, locale: string, catalog: Record<string, string>): void {
    let localeMap = this.#catalogs.get(namespace)
    if (!localeMap) {
      localeMap = new Map()
      this.#catalogs.set(namespace, localeMap)
    }

    const existing = localeMap.get(locale)
    if (existing) {
      Object.assign(existing, catalog)
    } else {
      localeMap.set(locale, { ...catalog })
    }

    this.dispatchEvent(new CustomEvent('change'))
  }

  registerOverrides(namespace: string, locale: string, catalog: Record<string, string>): void {
    let localeMap = this.#overrides.get(namespace)
    if (!localeMap) {
      localeMap = new Map()
      this.#overrides.set(namespace, localeMap)
    }

    const existing = localeMap.get(locale)
    if (existing) {
      Object.assign(existing, catalog)
    } else {
      localeMap.set(locale, { ...catalog })
    }

    this.dispatchEvent(new CustomEvent('change'))
  }

  resolveCell(directoryName: string, namespace = 'app'): string {
    const key = `cell.${directoryName}`
    const resolved = this.#resolve(key, undefined, namespace)
    return resolved !== undefined ? resolved : directoryName
  }

  t(key: string, params?: Record<string, string | number>, namespace = 'app'): string {
    const resolved = this.#resolve(key, params, namespace)
    return resolved !== undefined ? resolved : key
  }

  // -----------------------------------------------
  // internals
  // -----------------------------------------------

  #resolve(key: string, params: Record<string, string | number> | undefined, namespace: string): string | undefined {
    // Check overrides first (user/community layer takes priority)
    const overrideMap = this.#overrides.get(namespace)
    if (overrideMap) {
      const overrideTemplate =
        this.#lookup(overrideMap, this.#locale, key, params) ??
        this.#lookup(overrideMap, this.#fallback, key, params)
      if (overrideTemplate !== undefined) {
        return params ? this.#interpolate(overrideTemplate, params) : overrideTemplate
      }
    }

    // Fall back to catalog translations
    const localeMap = this.#catalogs.get(namespace)
    if (!localeMap) return undefined

    // Try current locale first, then fallback
    const template =
      this.#lookup(localeMap, this.#locale, key, params) ??
      this.#lookup(localeMap, this.#fallback, key, params)

    if (template === undefined) return undefined
    return params ? this.#interpolate(template, params) : template
  }

  #lookup(
    localeMap: Map<string, Record<string, string>>,
    locale: string,
    key: string,
    params: Record<string, string | number> | undefined,
  ): string | undefined {
    const catalog = localeMap.get(locale)
    if (!catalog) return undefined

    // Pluralization: check count-suffixed keys first
    if (params && typeof params['count'] === 'number') {
      const count = params['count'] as number
      if (count === 0 && catalog[`${key}.zero`] !== undefined) return catalog[`${key}.zero`]
      if (count === 1 && catalog[`${key}.one`] !== undefined) return catalog[`${key}.one`]
      if (catalog[`${key}.other`] !== undefined) return catalog[`${key}.other`]
    }

    return catalog[key]
  }

  #interpolate(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (_, token) => {
      const value = params[token]
      return value !== undefined ? String(value) : `{${token}}`
    })
  }
}

register('@hypercomb.social/I18n', new LocalizationService())
