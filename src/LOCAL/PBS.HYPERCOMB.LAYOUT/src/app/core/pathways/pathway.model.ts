// src/app/core/pathways/pathway.model.ts

export interface Rule<TContext = unknown> {
  readonly grammar: string
  enabled: boolean
}
