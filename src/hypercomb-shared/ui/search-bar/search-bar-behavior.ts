// hypercomb-shared/ui/search-bar/search-bar-behavior.ts

/**
 * A single atomic operation a behavior claims.
 *
 * Each operation is a distinct trigger+pattern pair the behavior handles.
 * The search bar uses these to:
 *   - detect overlaps at registration time
 *   - drive intellisense / hint display
 *   - generate help text
 */
export interface SearchBarOperation {
  /** Key combo that activates this operation, e.g. 'Enter', 'Shift+Enter', 'type' */
  readonly trigger: string
  /** Regex pattern the input must match (tested against trimmed input) */
  readonly pattern: RegExp
  /** Human-readable description of what this operation does */
  readonly description: string
  /** Concrete examples for intellisense and documentation */
  readonly examples: readonly SearchBarBehaviorExample[]
}

export interface SearchBarBehaviorExample {
  readonly input: string
  readonly key: string
  readonly result: string
}

/**
 * Introspectable metadata — everything the search bar needs to
 * display hints, detect conflicts, and generate documentation.
 */
export interface SearchBarBehaviorMeta {
  readonly name: string
  readonly operations: readonly SearchBarOperation[]
}

/**
 * A pluggable search bar behavior.
 *
 * Implementors declare their operations (for introspection) and provide
 * match/execute (for runtime dispatch). The search bar guarantees:
 *   - no two registered behaviors claim overlapping trigger+pattern
 *   - first match is deterministic (specificity, not insertion order)
 */
export interface SearchBarBehavior extends SearchBarBehaviorMeta {
  match(event: KeyboardEvent, input: string): boolean
  execute(input: string): Promise<void> | void
}
