// src/app/core/tree-node.ts

export type TreeNodeKind = 'domain' | 'layer' | 'bee' | 'dependency'

export interface AuditResult {
  signature: string
  approvedBy: string[]
  total: number
  meetsThreshold: boolean
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
}
