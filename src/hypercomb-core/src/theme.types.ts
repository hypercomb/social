// hypercomb-core/src/theme.types.ts
//
// Minimal theming contract. The implementation lives in hypercomb-shared;
// this interface lets essentials modules (e.g. the /theme queen) type-check
// their theme usage without importing from shared — which would violate the
// dependency direction.
//
// A "theme" is nothing more than a named value-set for the `--md-*` design
// tokens (see hypercomb-shared/styles/_material-tokens.scss). Components never
// name colors; they consume token roles. Switching a theme swaps the whole
// value-set under a `[data-theme="<name>"]` selector on <html>. Built-in
// themes (light/dark) ship as static CSS; community modules contribute extra
// themes at runtime via registerTheme(), exactly the way they contribute
// translations via I18nProvider.registerTranslations().

/** The map of `--md-*` token names → CSS values that defines a theme. */
export type ThemeTokens = Record<string, string>

export interface ThemeProvider {
  /** The active theme name, or 'system' when following the OS preference. */
  readonly theme: string
  /** All selectable themes: built-ins + runtime-registered (excludes 'system'). */
  readonly themes: readonly string[]
  /**
   * Switch the active theme. Pass a registered theme name, or 'system' to
   * follow `prefers-color-scheme`. Persists to localStorage (participant-local —
   * never enters the layer/lineage) and reflects onto `<html data-theme>`.
   */
  setTheme(name: string): void
  /**
   * Contribute a theme at runtime. Injects a `[data-theme="name"]{…}` block of
   * token overrides into a managed <style> element, so a community drone can
   * ship a theme the same way it ships translations. Re-registering a name
   * replaces its tokens.
   */
  registerTheme(name: string, tokens: ThemeTokens): void
}

export const THEME_IOC_KEY = '@hypercomb.social/Theme'
