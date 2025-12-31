// @hypercomb/core/src/action.ts
export interface ServiceLocator {
  has(id: string): boolean
  get<T = unknown>(id: string): T | undefined
}

export interface ActionContext {
  services: ServiceLocator
}

export interface HypercombAction {
  readonly id: string
  readonly requires?: readonly string[]
  run(ctx: ActionContext): Promise<void>
}
