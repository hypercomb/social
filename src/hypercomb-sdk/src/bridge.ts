// Bridge protocol types — shared between CLI (Node) and browser drone.

export const BRIDGE_PORT = 2401

export type BridgeOp = 'update' | 'note-add' | 'add' | 'remove' | 'list' | 'inspect' | 'history' | 'submit'

export type BridgeRequest = {
  id: string
  op: BridgeOp
  cells?: string[]
  all?: boolean
  cell?: string
  text?: string
  /** Parent path (segments). For `update`: the cell whose layer is being set.
   *  For legacy `add`: the parent under which children are added. */
  segments?: string[]
  /** Layer-as-primitive payload for `update`. Object of shape
   *  `{ name, ...slots }` where each slot value is an array of strings.
   *  Slot names are conventional (`children`, `tags`, `notes`, etc.). Empty
   *  arrays wipe the slot. The receiver mirrors `children` to OPFS folders
   *  and calls `LayerCommitter.update` for one awaited cascade per parent. */
  layer?: { name?: string } & { [slot: string]: unknown }
}

export type BridgeResponse = {
  id: string
  ok: boolean
  data?: unknown
  error?: string
}
