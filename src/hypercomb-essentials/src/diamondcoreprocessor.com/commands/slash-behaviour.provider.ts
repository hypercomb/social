// diamondcoreprocessor.com/ui/slash-behaviour/slash-behaviour.provider.ts

export interface SlashBehaviour {
  readonly name: string
  readonly description: string
  readonly descriptionKey?: string
  readonly aliases?: readonly string[]
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
