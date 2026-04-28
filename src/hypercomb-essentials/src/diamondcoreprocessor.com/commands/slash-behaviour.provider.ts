// diamondcoreprocessor.com/ui/slash-behaviour/slash-behaviour.provider.ts

export interface SlashBehaviour {
  readonly name: string
  readonly description: string
  readonly descriptionKey?: string
  readonly aliases?: readonly string[]
  /**
   * When true, this behaviour is invokable but does not appear in
   * autocomplete suggestions. Use for destructive / dev-only commands
   * the user must type in full (e.g. /compact, /collapse-history).
   */
  readonly hidden?: boolean
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
