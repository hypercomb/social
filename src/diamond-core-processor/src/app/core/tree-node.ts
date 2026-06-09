// diamond-core-processor/src/app/core/tree-node.ts

export type TreeNodeKind = 'domain' | 'layer' | 'bee' | 'dependency' | 'worker' | 'drone'

/**
 * Code kinds EXECUTE (bees, deps, workers, drones); data kinds (domain,
 * layer, tile, resource) are inert content. This split is the basis for
 * "adopt all tiles, leave functions off": adopted DATA defaults visible/on,
 * adopted CODE defaults OFF until the participant explicitly enables it
 * (which is also where the trust gate fires). One definition, used by both
 * the toggle DISPLAY default and the activation gate so they never diverge.
 */
export function isCodeKind(kind: TreeNodeKind | undefined): boolean {
  return kind === 'bee' || kind === 'dependency' || kind === 'worker' || kind === 'drone'
}

/** The absent-flag default for a node's toggle: adopted CODE is OFF until
 *  explicitly enabled; adopted DATA is ON. */
export function defaultEnabled(kind: TreeNodeKind | undefined): boolean {
  return !isCodeKind(kind)
}

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

  /**
   * EGG state — a layer that is KNOWN (held in the lineage) but has not
   * HATCHED (is not active in the logical install), for one of two reasons:
   *   - 'undelivered': its resources haven't resolved — no endpoint has the
   *     bytes yet. Hatches when an endpoint delivers (re-fetch succeeds).
   *   - 'untrusted': it's blocked because it doesn't meet the community
   *     safety requirements. Hatches when it meets the bar (a community
   *     attestation arrives, or the participant overrides the trust gate).
   * Eggs are durable + visible (never "failed", just "not yet"). Unset =
   * hatched/normal. The two causes render with one unified egg affordance.
   */
  hatchBlocker?: 'undelivered' | 'untrusted'

  /**
   * True for the node you JUST adopted (the tile's resolved root nested under
   * its host folder). Persistently highlighted — "this is what you just added,
   * ready to enable" — until you enable it or navigate away. Optional/false.
   */
  freshlyAdopted?: boolean
}
