// @hypercomb/core/src/dcp-message.ts

/**
 * structured message exchanged between DCP and Hypercomb parent
 * through postMessage — unwrapped, single-purpose, binary-capable
 */
export interface DcpResourceMessage {
  /** domain scoping: only messages explicitly marked 'dcp' are processed */
  scope: 'dcp'

  /** message type for routing — currently only 'resource.bytes' */
  type: 'resource.bytes'

  /** original payload name (filename / intent name) */
  name: string

  /** canonical payload signature */
  signature: string

  /** raw file bytes — transferred, not copied */
  bytes: ArrayBuffer
}
