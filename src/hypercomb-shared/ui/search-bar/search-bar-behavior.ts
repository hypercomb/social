// hypercomb-shared/ui/search-bar/search-bar-behavior.ts

export interface SearchBarBehaviorExample {
  readonly input: string
  readonly key: string
  readonly result: string
}

export interface SearchBarBehaviorMeta {
  readonly name: string
  readonly description: string
  readonly syntax: string
  readonly key: string
  readonly examples: readonly SearchBarBehaviorExample[]
}

export interface SearchBarBehavior extends SearchBarBehaviorMeta {
  match(event: KeyboardEvent, input: string): boolean
  execute(input: string): Promise<void> | void
}
