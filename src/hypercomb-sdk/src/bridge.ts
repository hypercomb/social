// Bridge protocol types — shared between CLI (Node) and browser drone.

export const BRIDGE_PORT = 2401

export type BridgeOp = 'add' | 'remove' | 'list' | 'inspect' | 'history'

export type BridgeRequest = {
  id: string
  op: BridgeOp
  seeds?: string[]
  all?: boolean
  seed?: string
}

export type BridgeResponse = {
  id: string
  ok: boolean
  data?: unknown
  error?: string
}
