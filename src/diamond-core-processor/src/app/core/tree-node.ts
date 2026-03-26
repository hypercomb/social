// diamond-core-processor/src/app/core/tree-node.ts

export type TreeNodeKind = 'domain' | 'layer' | 'bee' | 'dependency' | 'worker' | 'drone'

export interface AuditResult {
  signature: string
  approvedBy: string[]
  total: number
  meetsThreshold: boolean
}

export interface BeeDocEntry {
  className: string
  kind: 'drone' | 'worker' | 'queen' | 'bee'
  description: string
  effects: string[]
  listens: string[]
  emits: string[]
  deps: Record<string, string>
  grammar: { example: string; meaning?: string }[]
  links: { label: string; url: string; purpose?: string }[]
  command: string | null
  aliases: string[]
}

export interface LayerDocs {
  description?: string
  bees?: Record<string, BeeDocEntry>
}

export interface TreeNode {
  id: string
  name: string
  kind: TreeNodeKind
  signature?: string
  lineage: string
  parentId?: string
  children: TreeNode[]
  expanded: boolean
  loaded: boolean
  depth: number
  audit?: AuditResult
  doc?: BeeDocEntry
  layerDocs?: LayerDocs
}
