// i18n.service.ts — runtime localization service.
//
// Moved to CORE in the everything-is-a-beehavior Phase 1: the I18nProvider
// contract always lived here, and every surface — shell chrome and modules
// alike — needs t() from first paint, which is the kernel's definition. The
// CATALOGS stay where they are for now (shared/i18n, loaded lazily by the
// boot path); their split along module lines rides Phase 2 — each panel
// converted to a custom element carries its own keys via
// registerTranslations, with a drift check on the way.
//
// Extends EventTarget so Angular components can bridge to signals via
// fromRuntime(). Bees resolve via window.ioc.get(I18N_IOC_KEY).
//
// Translation catalogs are namespace-scoped: the host app uses 'app', community
// modules register under their own namespace (e.g., 'revolucionstyle.com').
//
// Pluralization: when params.count is present, looks for key.zero / key.one / key.other
// before falling back to the base key.
//
// Interpolation: replaces {token} placeholders with params[token].

import { EffectBus } from '../effect-bus.js'
import type { I18nProvider } from '../i18n.types.js'

const STORAGE_KEY = 'hc:locale'
const FALLBACK_LOCALE = 'en'

export class LocalizationService extends EventTarget implements I18nProvider {

  // namespace → locale → flat-key → translated string
  #catalogs = new Map<string, Map<string, Record<string, string>>>()
  // override layer — checked before #catalogs, lets users/community shadow bee translations
  #overrides = new Map<string, Map<string, Record<string, string>>>()
  #locale: string = FALLBACK_LOCALE
  #fallback = FALLBACK_LOCALE

  constructor() {
    super()
    // Core also evaluates in node contexts (CLI/SDK, node-env specs) where
    // window may be absent or a PARTIAL stub — require the pieces we read.
    if (typeof window === 'undefined' || !window.location
      || typeof localStorage === 'undefined' || typeof document === 'undefined') return

    // Detect initial locale: ?lang= URL param (session-only) → user preference → browser → fallback
    const urlLang = new URLSearchParams(window.location.search).get('lang')?.split('-')[0]
    const stored = localStorage.getItem(STORAGE_KEY)
    const browser = navigator.language?.split('-')[0] ?? FALLBACK_LOCALE
    this.#locale = urlLang ?? stored ?? browser

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
    this.#emitChange()
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

    this.#emitChange()
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

    this.#emitChange()
  }

  // Defer dispatch to a microtask so the impure `t` pipe's value flip
  // (key → translated string) lands in a NEW change-detection tick rather
  // than within the same tick as the registration. Without this, Angular's
  // dev-mode "ExpressionChangedAfterItHasBeenCheckedError" fires on every
  // boot for every i18n binding because translations register synchronously
  // during the first render. The user-visible behavior is identical; we
  // just stop spamming the console with the dev-only error. Multiple
  // sync registrations coalesce into one dispatch via the scheduled flag.
  #pendingDispatch = false
  #emitChange = (): void => {
    if (this.#pendingDispatch) return
    this.#pendingDispatch = true
    queueMicrotask(() => {
      this.#pendingDispatch = false
      this.dispatchEvent(new CustomEvent('change'))
    })
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

export const localizationService = new LocalizationService()

/** Register into the live IoC map when one exists (core also runs in node). */
export const ensureLocalizationRegistered = (): void => {
  const ioc = (globalThis as unknown as {
    ioc?: { has?: (k: string) => boolean; register?: (k: string, v: unknown) => void }
  }).ioc
  if (!ioc?.has?.('@hypercomb.social/I18n')) {
    ioc?.register?.('@hypercomb.social/I18n', localizationService)
  }
}
ensureLocalizationRegistered()
