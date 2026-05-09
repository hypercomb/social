// diamondcoreprocessor.com/sharing/paired-channel.service.ts
//
// Paired-channel sync — the substrate layer described in
// `documentation/sync-paired-channel.md`.
//
// Two participants pair a channel by agreeing on a lineage + a secret:
//
//   lineageSig = HistoryService.sign(lineage)        // canonical, content-addressed
//   channelId  = sha256(lineageSig + ':' + secret)   // length-prefixed
//
// `lineageSig` is the same signature the rest of the system already uses
// for that lineage's history bag — keeping the sync filter aligned with
// the canonical identity primitive prevents "two events with different
// addressing schemes" drift. Domain is not included (matches
// HistoryService.sign's contract: bag identity is path-only, mesh
// credentials are layered on top).
//
// The relay sees only the resulting channelId. Without the secret, the
// channelId is unguessable — even another participant on the same
// lineage but with a different secret resolves to a different filter
// and never receives our events. Strict pairing by construction; no
// fallback, no fuzzy match.
//
// All channel traffic flows as Nostr-shaped events of kind 29010 with a
// `type` tag carrying the verb (announce, share-request, audit-approve,
// ...). One generic primitive, a vocabulary of verbs. Receivers branch
// on the type tag and ignore unknown verbs (forward-compatible).
//
// This file is the publish/subscribe primitive. Verb-aware dispatch
// lives in the drone that consumes this service.

import { SignatureService } from '@hypercomb/core'

export const PAIRED_CHANNEL_KIND = 29010

/** Type tag values understood by this protocol. New verbs cost nothing — */
/** add a string here, write a handler. Receivers ignore unknown types. */
export type ChannelVerb =
  | 'announce'
  | 'join'
  | 'admit'
  | 'revoke'
  | 'share-request'
  | 'share'
  | 'share-revoked'
  | 'pulled'
  | 'layer'
  | 'node'
  | 'audit-needed'
  | 'approve'
  | 'reject'
  | 'auditors'

export interface ChannelEvent {
  /** The channelId tag value (== `x` tag on the wire). */
  readonly channelId: string
  /** The verb tag value. */
  readonly type: string
  /** Sender's pubkey (hex). */
  readonly pubkey: string
  /** Event id (hex sha256 of the canonical event). */
  readonly id: string
  /** Unix seconds when the sender created the event. */
  readonly createdAt: number
  /** Parsed event content (caller-defined JSON), or the raw string if not JSON. */
  readonly content: unknown
  /** Full tag list, for callers that need access beyond `type`. */
  readonly tags: readonly (readonly string[])[]
  /** Original Nostr event in case a handler needs the raw bytes. */
  readonly raw: unknown
}

export type ChannelHandler = (e: ChannelEvent) => void
export type ChannelSubscription = { close: () => void }

interface MeshLike {
  publish(kind: number, sig: string, payload: unknown, extraTags?: string[][]): Promise<boolean>
  subscribe(sig: string, cb: (e: { event: { tags?: unknown[][]; content?: unknown; pubkey?: string; id?: string; created_at?: number }; payload: unknown }) => void): { close: () => void }
}

const TEXT_ENCODER = new TextEncoder()

/**
 * Lightweight shape that matches what HistoryService.sign accepts —
 * any object exposing `explorerSegments()`. Domain is intentionally
 * not part of the bag-identity contract (see HistoryService.sign).
 */
export interface LineageLike {
  explorerSegments: () => readonly string[]
  domain?: () => string
}

interface HistoryServiceLike {
  sign: (lineage: LineageLike) => Promise<string>
}

/**
 * Derive the channel id from a lineage signature + secret. Both sides
 * MUST sign the same lineage (same explorerSegments) and supply the
 * same secret, or their channelIds diverge.
 *
 * Output: 64 lowercase hex characters (sha-256).
 */
export async function channelIdFor(lineageSig: string, secret: string): Promise<string> {
  const sig = String(lineageSig ?? '').trim().toLowerCase()
  const sec = String(secret ?? '')
  if (!/^[0-9a-f]{64}$/.test(sig)) throw new Error('paired-channel: lineageSig must be 64 hex chars')
  if (!sec) throw new Error('paired-channel: secret is required')
  // Length-prefixed concat so the (sig, sec) tuple maps to a unique
  // input. You can't construct two distinct (a, b) and (a', b') that
  // hash to the same channel by playing with separators.
  const buf = TEXT_ENCODER.encode(`${sig.length}:${sig}|${sec.length}:${sec}`)
  return SignatureService.sign(buf.buffer as ArrayBuffer)
}

/**
 * Convenience: signs the lineage internally via HistoryService.sign,
 * then derives the channelId. This is the path most callers use —
 * the lineage object usually comes from `@hypercomb.social/Lineage`.
 *
 * If HistoryService isn't registered yet, falls back to signing
 * `segments.join('/')` directly (matches HistoryService's own scheme),
 * so the result stays identical regardless of who computed it.
 */
export async function channelIdForLineage(
  lineage: LineageLike,
  secret: string,
): Promise<string> {
  const history = window.ioc.get(
    '@diamondcoreprocessor.com/HistoryService',
  ) as HistoryServiceLike | undefined
  let lineageSig: string
  if (history?.sign) {
    lineageSig = await history.sign(lineage)
  } else {
    // Mirror HistoryService.sign's algorithm so the fallback produces
    // the same bytes the rest of the system would produce. Empty
    // segments → empty string → the canonical "root" lineage sig.
    const segments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(s => s.length > 0)
    const key = segments.join('/')
    lineageSig = await SignatureService.sign(TEXT_ENCODER.encode(key).buffer as ArrayBuffer)
  }
  return channelIdFor(lineageSig, secret)
}

/**
 * Convenience: same `channelIdFor` but never throws — returns `null`
 * when inputs are invalid. Useful in UI paths where the user is
 * mid-typing.
 */
export async function tryChannelId(lineageSig: string, secret: string): Promise<string | null> {
  try {
    return await channelIdFor(lineageSig, secret)
  } catch {
    return null
  }
}

export class PairedChannelService {

  /** Per-channel handler bookkeeping so re-subscribes aren't duplicated. */
  readonly #subs = new Map<string, { meshSub: { close: () => void }; handlers: Set<ChannelHandler> }>()

  /**
   * Publish an event into a channel. Caller supplies the verb (`type` tag)
   * and the JSON payload. Extra tags are appended verbatim — caller is
   * responsible for following the tag conventions in the spec.
   *
   * Returns false if the mesh isn't available (no signer, no relay) —
   * the caller can decide whether to retry, queue, or surface the error.
   */
  async publish(
    channelId: string,
    type: ChannelVerb | string,
    payload: unknown,
    extraTags: string[][] = [],
  ): Promise<boolean> {
    if (!isChannelId(channelId)) {
      console.warn('[paired-channel] publish ignored: invalid channelId', channelId)
      return false
    }
    if (!type) {
      console.warn('[paired-channel] publish ignored: missing type')
      return false
    }
    const mesh = this.#mesh()
    if (!mesh) {
      console.warn('[paired-channel] publish: mesh unavailable, dropping event', { channelId, type })
      return false
    }
    const tags = [['type', String(type)], ...extraTags.filter(t => Array.isArray(t) && t.length >= 2)]
    return mesh.publish(PAIRED_CHANNEL_KIND, channelId, payload, tags)
  }

  /**
   * Subscribe to a channel. The handler receives every event whose
   * channelId matches and whose kind is 29010. Unknown verbs are still
   * delivered — the dispatcher decides what to ignore.
   *
   * Returns a subscription object; call `.close()` to detach. Multiple
   * subscriptions to the same channel share a single mesh subscription;
   * closing one only detaches that handler.
   */
  subscribe(channelId: string, handler: ChannelHandler): ChannelSubscription {
    if (!isChannelId(channelId)) {
      console.warn('[paired-channel] subscribe ignored: invalid channelId', channelId)
      return { close: () => {} }
    }
    const mesh = this.#mesh()
    if (!mesh) {
      console.warn('[paired-channel] subscribe: mesh unavailable')
      return { close: () => {} }
    }

    const existing = this.#subs.get(channelId)
    if (existing) {
      existing.handlers.add(handler)
      return { close: () => this.#detach(channelId, handler) }
    }

    const handlers = new Set<ChannelHandler>([handler])
    const meshSub = mesh.subscribe(channelId, (msg) => {
      const evt = msg?.event
      if (!evt) return
      const ce = parseChannelEvent(channelId, evt)
      if (!ce) return
      // Snapshot handlers — handlers may unsubscribe inside their callback.
      for (const h of [...handlers]) {
        try { h(ce) } catch (err) { console.warn('[paired-channel] handler threw', ce.type, err) }
      }
    })
    this.#subs.set(channelId, { meshSub, handlers })

    return { close: () => this.#detach(channelId, handler) }
  }

  // ── internals ──────────────────────────────────────────────────────

  #detach(channelId: string, handler: ChannelHandler): void {
    const entry = this.#subs.get(channelId)
    if (!entry) return
    entry.handlers.delete(handler)
    if (entry.handlers.size === 0) {
      try { entry.meshSub.close() } catch { /* mesh teardown best-effort */ }
      this.#subs.delete(channelId)
    }
  }

  #mesh(): MeshLike | null {
    const mesh = window.ioc.get('@diamondcoreprocessor.com/NostrMeshDrone') as MeshLike | undefined
    return mesh ?? null
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/** A channel id is exactly 64 lowercase hex chars (sha-256 hex digest). */
export function isChannelId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function parseChannelEvent(
  channelId: string,
  evt: { tags?: unknown[][]; content?: unknown; pubkey?: string; id?: string; created_at?: number },
): ChannelEvent | null {
  const tags = Array.isArray(evt.tags) ? evt.tags : []
  let type = ''
  for (const t of tags) {
    if (Array.isArray(t) && t.length >= 2 && t[0] === 'type') { type = String(t[1]); break }
  }
  if (!type) return null
  const rawContent = evt.content
  let content: unknown = rawContent
  if (typeof rawContent === 'string' && rawContent.length > 0) {
    try { content = JSON.parse(rawContent) } catch { /* keep raw string */ }
  }
  return {
    channelId,
    type,
    pubkey: typeof evt.pubkey === 'string' ? evt.pubkey : '',
    id: typeof evt.id === 'string' ? evt.id : '',
    createdAt: typeof evt.created_at === 'number' ? evt.created_at : 0,
    content,
    tags: tags.map(t => Array.isArray(t) ? t.map(String) : []),
    raw: evt,
  }
}

// ── registration ─────────────────────────────────────────────────────

const _pairedChannelService = new PairedChannelService()
window.ioc.register('@diamondcoreprocessor.com/PairedChannelService', _pairedChannelService)
