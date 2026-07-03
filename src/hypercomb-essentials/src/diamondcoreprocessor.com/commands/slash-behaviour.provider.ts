// diamondcoreprocessor.com/ui/slash-behaviour/slash-behaviour.provider.ts

export interface SlashBehaviour {
  readonly name: string
  readonly description: string
  readonly descriptionKey?: string
  readonly aliases?: readonly string[]
  /**
   * When true, this behaviour is invokable but does not appear in
   * autocomplete suggestions. Use for destructive / dev-only commands
   * the user must type in full (e.g. /flatten, /collapse-history).
   */
  readonly hidden?: boolean
  /**
   * STRUCTURED USAGE DOCS — supplied by the author at creation (QueenBee's
   * `options` / `examples` flow straight through the auto-wrap). Reference
   * surfaces read these fields; they never parse the description string.
   * Options are accepted values or forms ('on', 'off', '<color>').
   */
  readonly options?: readonly string[]
  /** Worked examples: what to type and what happens. */
  readonly examples?: readonly { readonly input: string; readonly result: string }[]
}

export interface SlashBehaviourMatch {
  readonly behaviour: SlashBehaviour
  readonly provider: SlashBehaviourProvider
}

export interface SlashBehaviourProvider {
  readonly name: string
  readonly priority: number
  readonly behaviours: readonly SlashBehaviour[]
  execute(behaviourName: string, args: string): Promise<void> | void
  complete?(behaviourName: string, args: string): readonly string[]
}
