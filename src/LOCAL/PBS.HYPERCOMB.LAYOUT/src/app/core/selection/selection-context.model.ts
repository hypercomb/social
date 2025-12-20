// src/app/core/selection/selection-context.model.ts

export interface SelectionContext {
  lineage: string              // lineage the selection belongs to
  seeds: string[]                // selected entities (cells, tiles, etc)
  primarySeed?: string             // optional anchor
  source: 'hover' | 'focus' | 'gesture' | 'programmatic'
}
