// hypercomb-shared/core/theme.service.ts
//
// Runtime theming service. Extends EventTarget so Angular components can bridge
// to signals via fromRuntime(). Bees/queens resolve via window.ioc.get(THEME_IOC_KEY).
//
// A theme is a named value-set for the `--md-*` design tokens. The contract
// (the token names + the light/dark value-sets) lives in static CSS at
// hypercomb-shared/styles/_material-tokens.scss. This service does three things:
//
//   1. Holds the active theme name (participant-local — persisted to
//      localStorage, NEVER written into the layer/lineage, same rule as locale,
//      viewport and clipboard).
//   2. Reflects it onto `<html data-theme="…">` so the static CSS selectors
//      take over. 'system' removes the attribute and falls back to the
//      `prefers-color-scheme` media query.
//   3. Lets community modules contribute *new* themes at runtime via
//      registerTheme(), by injecting a `[data-theme="name"]{…}` block into a
//      managed <style> element — the theming analog of
//      I18nProvider.registerTranslations().
//
// The pre-paint snippet in each shell's index.html applies the stored attribute
// before first paint to avoid a flash; this service is the authoritative
// runtime owner thereafter.

import { EffectBus, THEME_IOC_KEY } from '@hypercomb/core'
import type { ThemeProvider, ThemeTokens } from '@hypercomb/core'

const STORAGE_KEY = 'hc:theme'
// Default when the participant has never chosen. `honey` — the bright warm
// look — is what a hive opens as; dark, light and system are all one word away
// via setTheme(). This value MUST match the pre-paint fallback in both shells'
// index.html ([[web/dev shell parity]]), or the first paint flashes one theme
// and the service replaces it with another.
const DEFAULT_THEME = 'honey'
const SYSTEM = 'system'
// Built-in themes defined in static CSS (_material-tokens.scss). Registered
// themes are appended to this set at runtime.
//
// light/dark are the two ends of one dimmer; honey/bloom/sherbet are LOOKS —
// bright value-sets with their own accent chord, coloured elevation and a
// livelier motion curve. Order is the order `/theme` offers them.
const BUILTINS = ['light', 'dark', 'honey', 'bloom', 'sherbet'] as const

// id of the managed <style> that holds runtime-registered theme blocks
const REGISTRY_STYLE_ID = 'hc-theme-registry'

export class ThemeService extends EventTarget implements ThemeProvider {

  #theme: string
  // name → token map, for runtime-registered themes only
  #registered = new Map<string, ThemeTokens>()

  constructor() {
    super()

    // Resolve initial theme: ?theme= URL param (session-only) → stored pref → default.
    const urlTheme = new URLSearchParams(window.location.search).get('theme')?.toLowerCase()
    const stored = localStorage.getItem(STORAGE_KEY)
    this.#theme = urlTheme ?? stored ?? DEFAULT_THEME

    this.#apply(this.#theme)
  }

  // -----------------------------------------------
  // ThemeProvider interface
  // -----------------------------------------------

  get theme(): string {
    return this.#theme
  }

  get themes(): readonly string[] {
    // built-ins first, then any runtime-registered themes (deduped)
    const extra = [...this.#registered.keys()].filter(n => !BUILTINS.includes(n as any))
    return [...BUILTINS, ...extra]
  }

  setTheme(name: string): void {
    if (this.#theme === name) return
    this.#theme = name
    localStorage.setItem(STORAGE_KEY, name)
    this.#apply(name)
    EffectBus.emit('theme:changed', { theme: name })
    this.dispatchEvent(new CustomEvent('change'))
  }

  // Re-apply the participant's theme, returning true only when the live
  // attribute had DRIFTED from it. An embedded website page stamps the same
  // `<html data-theme>` this service owns — a pre-paint script and an in-page
  // toggle both write it raw — and the base token set in _material-tokens.scss
  // is the LIGHT one (dark is the `[data-theme="dark"]` override), so any
  // leftover stamp, or the attribute going missing on a light-OS machine, paints
  // the whole hive cream. Callers leaving a foreign surface use this to hand the
  // attribute back to its owner instead of trusting a snapshot.
  //
  // Emitting theme:changed only on a real correction keeps the derived surfaces
  // honest (the canvas backdrop repaints its auto palette off this effect)
  // without a repaint on every idempotent call.
  reassert(): boolean {
    const want = this.#theme === SYSTEM ? null : this.#theme
    if (document.documentElement.getAttribute('data-theme') === want) return false
    this.#apply(this.#theme)
    EffectBus.emit('theme:changed', { theme: this.#theme })
    this.dispatchEvent(new CustomEvent('change'))
    return true
  }

  registerTheme(name: string, tokens: ThemeTokens): void {
    this.#registered.set(name, { ...tokens })
    this.#renderRegistry()
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -----------------------------------------------
  // internals
  // -----------------------------------------------

  // Reflect the chosen theme onto <html>. 'system' clears the attribute so the
  // `prefers-color-scheme` media query in _material-tokens.scss takes over.
  #apply(name: string): void {
    const root = document.documentElement
    if (name === SYSTEM) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', name)
  }

  // Rebuild the managed <style> from the registered theme maps. One element,
  // rewritten in full on each change — themes are tiny and this keeps the DOM
  // free of orphaned blocks when a theme is re-registered.
  #renderRegistry(): void {
    let style = document.getElementById(REGISTRY_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = REGISTRY_STYLE_ID
      document.head.appendChild(style)
    }
    const blocks: string[] = []
    for (const [name, tokens] of this.#registered) {
      const decls = Object.entries(tokens)
        .map(([k, v]) => `  ${k.startsWith('--') ? k : `--${k}`}: ${v};`)
        .join('\n')
      blocks.push(`[data-theme="${name}"] {\n${decls}\n}`)
    }
    style.textContent = blocks.join('\n\n')
  }
}

register(THEME_IOC_KEY, new ThemeService())
