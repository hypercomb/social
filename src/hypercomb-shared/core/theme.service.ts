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

// The key the root value-set is filed under while reading the stylesheets. It
// is not a theme name — `light` IS `:root` (there is no [data-theme="light"]
// block; light is what you get when no override applies), so the root set is
// both the light theme and the base every other theme is read on top of.
const ROOT_BLOCK = ':root'

/** Which theme a selector dresses: the root set, or one `[data-theme]` block.
 *  Anything else in the document is not a value-set and is passed over. */
const themeBlock = (selector: string): string | undefined => {
  if (selector === ROOT_BLOCK) return ROOT_BLOCK
  const match = selector.match(/^\[data-theme=["']?([\w-]+)["']?\]$/i)
  return match ? match[1].toLowerCase() : undefined
}

export class ThemeService extends EventTarget implements ThemeProvider {

  #theme: string
  // name → token map, for runtime-registered themes only
  #registered = new Map<string, ThemeTokens>()
  // theme name → the `--md-*` values it would put on the document, and the
  // per-block reading of the live stylesheets they are merged from. Both are
  // caches of something recomputable — cleared when a theme is registered,
  // rebuilt when the sheet count moves.
  #tokenCache = new Map<string, ReadonlyMap<string, string>>()
  #blocks: Map<string, Map<string, string>> | undefined
  #blocksAt = -1

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
    this.#tokenCache.clear()
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -----------------------------------------------
  // the sample a theme would give
  // -----------------------------------------------
  //
  // A NAME IS NOT A LOOK. `/theme sherbet` was a word you had to APPLY to find
  // out what it was, and then apply another one to get back — the whole list
  // read as five arbitrary nouns. A theme can show itself instead: its own
  // ground, its own panel, its own accent chord, in a strip the command line
  // draws beside the name.
  //
  // READ, NEVER COPIED. The value-sets live in _material-tokens.scss and
  // nowhere else; five palettes transcribed into TypeScript would be a second
  // source of truth that drifts the first time a look is retuned. So the strip
  // is assembled from the LIVE stylesheet — `:root` is the light value-set,
  // every other built-in is an override block on top of it, and a
  // runtime-registered theme is the token map this service already holds. A
  // community theme that names three tokens samples correctly for the same
  // reason: what it does not override, it inherits.

  /** A CSS `background` showing the theme's palette: ground, panel, then the
   *  primary/secondary/tertiary chord. '' when it cannot be read. */
  swatch(name: string): string {
    const tokens = this.#tokensOf(this.#resolve(name))
    const value = (token: string) => tokens.get(token)?.trim() ?? ''
    const ground = value('--md-surface')
    const panel = value('--md-surface-c-high') || ground
    const primary = value('--md-primary')
    const secondary = value('--md-secondary') || primary
    const tertiary = value('--md-tertiary') || primary
    if (!ground || !primary) return ''
    return `linear-gradient(90deg, ${ground} 0 34%, ${panel} 34% 52%, ` +
      `${primary} 52% 68%, ${secondary} 68% 84%, ${tertiary} 84% 100%)`
  }

  /** Bright or dark, as the theme itself declares it. */
  mood(name: string): 'light' | 'dark' | '' {
    const declared = this.#tokensOf(this.#resolve(name)).get('--md-is-light')?.trim()
    if (!declared) return ''
    return declared === '0' ? 'dark' : 'light'
  }

  // 'system' is not a value-set — it is whichever end the machine is asking
  // for right now, so it samples that one.
  #resolve(name: string): string {
    const key = (name || '').toLowerCase().trim()
    if (key !== SYSTEM) return key
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  /** The `--md-*` values a theme would put on the document: the root set with
   *  the theme's own block laid over it. */
  #tokensOf(name: string): ReadonlyMap<string, string> {
    const cached = this.#tokenCache.get(name)
    if (cached) return cached
    const blocks = this.#sheetTokens()
    const merged = new Map(blocks.get(ROOT_BLOCK) ?? [])
    for (const [token, value] of blocks.get(name) ?? []) merged.set(token, value)
    for (const [token, value] of Object.entries(this.#registered.get(name) ?? {})) {
      merged.set(token.startsWith('--') ? token : `--${token}`, value)
    }
    if (merged.size) this.#tokenCache.set(name, merged)
    return merged
  }

  /** Every `--md-*` declaration in the document, filed by the theme it dresses
   *  (`:root` under {@link ROOT_BLOCK}). Cached until a stylesheet arrives or
   *  leaves — a drone may inject one at any time. */
  #sheetTokens(): ReadonlyMap<string, Map<string, string>> {
    if (this.#blocks && this.#blocksAt === document.styleSheets.length) return this.#blocks
    const blocks = new Map<string, Map<string, string>>()

    const collect = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules) as any[]) {
        // A conditional block is skipped whole. The only one in the token sheet
        // is the prefers-color-scheme duplicate of dark, and reading it would
        // file dark's values under the root set.
        if (rule.media || rule.conditionText) continue
        const selector: string | undefined = rule.selectorText
        const style: CSSStyleDeclaration | undefined = rule.style
        if (selector && style) {
          for (const part of selector.split(',')) {
            const block = themeBlock(part.trim())
            if (!block) continue
            let bucket = blocks.get(block)
            if (!bucket) blocks.set(block, bucket = new Map())
            for (const property of Array.from(style)) {
              if (property.startsWith('--')) bucket.set(property, style.getPropertyValue(property))
            }
          }
        }
        // NOT an `else`. A style rule is itself a grouping rule now (CSS
        // nesting), so `cssRules` is present on every one of them — reading it
        // as the mark of a wrapper skipped every declaration in the sheet.
        if (rule.cssRules) collect(rule.cssRules)
      }
    }

    for (const sheet of Array.from(document.styleSheets)) {
      // A cross-origin sheet refuses its rules; it holds none of ours.
      try { collect(sheet.cssRules) } catch { /* opaque sheet */ }
    }

    if (blocks.size) {
      this.#blocks = blocks
      this.#blocksAt = document.styleSheets.length
    }
    return blocks
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
