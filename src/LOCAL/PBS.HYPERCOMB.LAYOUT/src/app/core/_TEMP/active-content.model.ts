// src/app/core/diamond-core/active-context.model.ts

export interface ActiveContext {
  key: string
  kind: 'tile' | 'cell' | 'view' | 'transient'
  lineage: string
  source: 'click' | 'operation' | 'navigation' | 'programmatic' | 'selection'
  locked?: boolean
  expiresOnCommit?: boolean
}
