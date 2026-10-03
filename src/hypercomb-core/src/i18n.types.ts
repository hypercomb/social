// hypercomb-core/src/i18n.types.ts
//
// Minimal i18n contract. The implementation lives in hypercomb-shared;
// this interface lets essentials modules type-check their i18n usage
// without importing from shared (which would violate the dependency direction).

export interface I18nProvider {
  readonly locale: string
  t(key: string, params?: Record<string, string | number>, namespace?: string): string
  registerTranslations(namespace: string, locale: string, catalog: Record<string, string>): void
  /**
   * Register override translations that take priority over catalog translations.
   * Users and community modules call this to shadow bee-provided labels.
   */
  registerOverrides(namespace: string, locale: string, catalog: Record<string, string>): void
  /**
   * The active theme's words, keyed by locale (see ThemeProvider.registerThemeWords).
   * Resolved after the participant's overrides and before the catalog.
   * Optional so an older shell's provider still satisfies the contract.
   */
  setThemeWords?(words: Record<string, Record<string, string>> | undefined): void
  /**
   * Resolve a cell's display label for the current locale.
   * Resolution order: overrides → catalog → labelSig resource → raw directory name.
   * The key convention is `cell.{directoryName}` within the given namespace.
   */
  resolveCell(directoryName: string, namespace?: string): string
  setLocale(locale: string): void
}

export const I18N_IOC_KEY = '@hypercomb.social/I18n'
