// suggestion.types.ts — command-line suggestion contracts.
//
// SuggestionProvider moved from hypercomb-shared in the
// everything-is-a-beehavior Phase 1; the cell provider implementation lives
// in essentials (commands/cell-suggestion.provider.ts) and announces
// CELL_SUGGESTIONS_CHANGED on EffectBus after every refresh (payload-free —
// subscribers re-read the lazily resolved instance).

import type { RosterRow } from './level-roster.js'

export const CELL_SUGGESTION_KEY = '@hypercomb.social/CellSuggestionProvider'
export const CELL_SUGGESTIONS_CHANGED = 'cells:suggestions-changed'

/**
 * A source of autocomplete suggestions for the command line.
 * Providers extend EventTarget and dispatch 'change' when their
 * suggestion list updates. The command line aggregates all registered
 * providers and merges their results.
 */
export interface SuggestionProvider extends EventTarget {
  readonly providerName: string
  suggestions(): readonly string[]
}

export interface CellSuggestionSource extends SuggestionProvider {
  /** The level as the rail reads it — one row per tile in parent order. */
  roster(): readonly RosterRow[]
  /** Query cells at a sub-path relative to the current explorer directory. */
  query(subPath: readonly string[]): void
}
