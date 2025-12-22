// src/app/core/pathways/pathway-context.model.ts

export interface PathwayContext {
  lineage: string
  selection?: {
    lineage?: string
    seeds?: string[]
  }
  activeEdge?: string
}
