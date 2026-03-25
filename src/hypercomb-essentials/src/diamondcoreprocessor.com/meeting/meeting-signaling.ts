// diamondcoreprocessor.com/meeting/meeting-signaling.ts

/**
 * Nostr signaling protocol for HypercombMeeting.
 *
 * All events use kind 29011, tagged ['x', roomSig] for relay fan-out.
 * The ['t', type] tag differentiates signal types.
 * The ['p', targetPeerId] tag addresses SDP/ICE to a specific peer.
 */

export const MEETING_KIND = 29011

export type SignalType = 'join' | 'leave' | 'offer' | 'answer' | 'ice'

export type JoinPayload   = { peerId: string }
export type LeavePayload  = { peerId: string }
export type OfferPayload  = { sdp: RTCSessionDescriptionInit; fromPeerId: string }
export type AnswerPayload = { sdp: RTCSessionDescriptionInit; fromPeerId: string }
export type IcePayload    = { candidate: RTCIceCandidateInit; fromPeerId: string }

export type SignalPayload = JoinPayload | LeavePayload | OfferPayload | AnswerPayload | IcePayload

export type InboundSignal = {
  type: SignalType
  roomSig: string
  payload: SignalPayload
  targetPeerId?: string   // present on offer/answer/ice
  sourcePubkey?: string
}

// ── create helpers ──────────────────────────────────────────

export function meetingExtraTags(type: SignalType, targetPeerId?: string): string[][] {
  const tags: string[][] = [['t', type]]
  if (targetPeerId) tags.push(['p', targetPeerId])
  return tags
}

// ── parse helpers ───────────────────────────────────────────

export function parseMeetingSignal(event: { tags: string[][]; content: string }, roomSig: string): InboundSignal | null {
  const typeTag = event.tags.find(t => t[0] === 't')
  if (!typeTag) return null

  const type = typeTag[1] as SignalType
  if (!['join', 'leave', 'offer', 'answer', 'ice'].includes(type)) return null

  const pTag = event.tags.find(t => t[0] === 'p')

  let payload: SignalPayload
  try {
    payload = JSON.parse(event.content)
  } catch {
    return null
  }

  return {
    type,
    roomSig,
    payload,
    targetPeerId: pTag?.[1],
    sourcePubkey: (event as any).pubkey,
  }
}

// ── peer ID generation ──────────────────────────────────────

export function meetingPeerId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
