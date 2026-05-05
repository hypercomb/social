// Bridge protocol types — shared between CLI (Node) and browser drone.

export const BRIDGE_PORT = 2401

export type BridgeOp = 'add' | 'remove' | 'list' | 'inspect' | 'history' | 'submit'

export type BridgeRequest = {
  id: string
  op: BridgeOp
  cells?: string[]
  all?: boolean
  cell?: string
  text?: string
  /** Optional parent path for `add`. Worker walks/creates segments, then adds
   *  the children at that depth with segments-aware cell:added emits so the
   *  cascade starts at the correct ancestor. Lets the CLI bulk-import without
   *  needing to navigate the renderer between each batch. */
  segments?: string[]
}

export type BridgeResponse = {
  id: string
  ok: boolean
  data?: unknown
  error?: string
}
