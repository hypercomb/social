// hypercomb-core/src/dcp-message.ts

/**
 * structured message exchanged between DCP and Hypercomb
 * through postMessage — unwrapped, single-purpose, binary-capable
 */
export interface DcpResourceMessage {
  scope: 'dcp'
  type: 'resource.bytes'
  name: string
  signature: string
  bytes: ArrayBuffer
}

export interface DcpNavigateMessage {
  scope: 'dcp'
  type: 'navigate'
  lineage: string[]
  domain: string
}

export interface DcpToggleMessage {
  scope: 'dcp'
  type: 'toggle'
  nodeId: string
  enabled: boolean
  lineage: string[]
}

export type DcpMessage = DcpResourceMessage | DcpNavigateMessage | DcpToggleMessage
