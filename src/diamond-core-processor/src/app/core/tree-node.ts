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

  /**
   * True when this node is a placeholder for content still being fetched
   * (the typical case: adoption just kicked off; the host is materializing
   * bytes; the row is visible as a muted "...resolving" placeholder until
   * the real subtree replaces it). Optional / defaults to false; existing
   * nodes are unaffected.
   */
  pending?: boolean

  /**
   * True when this node is a READ-ONLY VISUAL of an item already in the
   * logical install from ANOTHER domain or the default base — shown as
   * context (border/background-marked) so you see how this domain's
   * incoming features land among what's already there. Visual-context
   * nodes are not toggleable (they belong to another silo); only this
   * domain's own (non-visual) features toggle. Optional / defaults false.
   */
  visualContext?: boolean
}
