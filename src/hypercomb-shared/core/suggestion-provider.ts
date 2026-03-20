// hypercomb-shared/core/suggestion-provider.ts

/**
 * A source of autocomplete suggestions for the search bar.
 * Providers extend EventTarget and dispatch 'change' when their
 * suggestion list updates. The search bar aggregates all registered
 * providers and merges their results.
 */
export interface SuggestionProvider extends EventTarget {
  readonly providerName: string
  suggestions(): readonly string[]
}
