// hypercomb-runtime/src/shell-contracts.ts
//
// WHAT THE RUNTIME EXPECTS OF THE SHELL, structurally.
//
// `runtime-initializer` resolves five services out of IoC. It never constructs
// them, never imports their modules for a side effect, and uses a handful of
// members off each — so the only thing it actually needs is their SHAPE.
// Importing the classes to get that shape would drag `hypercomb-shared` back
// into this package and undo the boundary in a single line, invisibly, because
// four of the five were already `import type` and cost nothing at build time.
// A type-only edge is still an edge once this package is published.
//
// So the shapes live here, narrow on purpose: each one lists what is used and
// nothing more. A service that grows a method the runtime does not call does
// not belong in this file.
//
// The keys these are resolved by are the contract; the classes behind them are
// the shell's business. Today they live in `hypercomb-shared/core`; `Lineage`
// and `Navigation` are migrating to `@hypercomb/core`. Neither move touches
// anything here — which is the point.

/** `@hypercomb.social/OpfsTreeLogger` — boot-time OPFS tree dump.
 *
 *  NOTE: its module self-registers, so it is only present when something
 *  imports it. The runtime does not, deliberately: the dump is a diagnostic
 *  behind `logOpfs`, and an absent logger is a missing log line rather than a
 *  missing feature. */
export type TreeLoggerLike = {
  log(label?: string): void | Promise<void>
}

/** `@hypercomb.social/I18n` — the localization service. */
export type LocalizationLike = {
  readonly locale: string
  registerTranslations(namespace: string, locale: string, table: Record<string, string>): void
  registerOverrides(namespace: string, locale: string, table: Record<string, string>): void
}

/** `@hypercomb.social/Lineage` — the participant's history spine. */
export type LineageLike = {
  initialize(): Promise<void>
  /** A METHOD, not a property — resolving the head is async. */
  currentSig(): Promise<string>
  explorerSegments(): readonly string[]
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
}

/** `@hypercomb.social/Navigation` — URL ⇄ location. */
export type NavigationLike = {
  listen(): void
}

/** `@hypercomb.social/BootstrapHistory` — Phase-1 URL restore. */
export type BootstrapHistoryLike = {
  run(): Promise<void>
}
