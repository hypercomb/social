// hypercomb-shared/ui/command-line/command-line-behavior.ts

/**
 * A single atomic operation a behavior claims.
 *
 * Each operation is a distinct trigger+pattern pair the behavior handles.
 * The command line uses these to:
 *   - detect overlaps at registration time
 *   - drive intellisense / hint display
 *   - generate help text
 */
export interface CommandLineOperation {
  /** Key combo that activates this operation, e.g. 'Enter', 'Shift+Enter', 'type' */
  readonly trigger: string
  /** Regex pattern the input must match (tested against trimmed input) */
  readonly pattern: RegExp
  /** Human-readable description of what this operation does */
  readonly description: string
  /** Concrete examples for intellisense and documentation */
  readonly examples: readonly CommandLineBehaviorExample[]
}

export interface CommandLineBehaviorExample {
  readonly input: string
  readonly key: string
  readonly result: string
}

/**
 * Introspectable metadata — everything the command line needs to
 * display hints, detect conflicts, and generate documentation.
 */
export interface CommandLineBehaviorMeta {
  readonly name: string
  readonly operations: readonly CommandLineOperation[]
}

/**
 * A pluggable command line behavior.
 *
 * Implementors declare their operations (for introspection) and provide
 * match/execute (for runtime dispatch). The command line guarantees:
 *   - no two registered behaviors claim overlapping trigger+pattern
 *   - first match is deterministic (specificity, not insertion order)
 */
export interface CommandLineBehavior extends CommandLineBehaviorMeta {
  match(event: KeyboardEvent, input: string): boolean
  execute(input: string): Promise<void> | void
}
