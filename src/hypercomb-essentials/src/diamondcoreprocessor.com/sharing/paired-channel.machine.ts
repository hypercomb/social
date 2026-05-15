// diamondcoreprocessor.com/sharing/paired-channel.machine.ts
//
// Pure state machine per paired channel. Every transaction in the
// protocol — membership, share offers, approvals, downloads, audits —
// flows through `apply(event)`. The machine is deterministic: same
// event sequence in, same state out. No side effects, no DOM, no IoC,
// no mesh access. Consumers feed it events and read derived state.
//
// One instance per channelId. The orchestrator (paired-channel.drone)
// owns the instances and routes incoming `ChannelEvent`s to the
// matching machine based on `event.channelId`.

import type { ChannelEvent } from './paired-channel.service.js'

// ── state shape ──────────────────────────────────────────────────────

export type ShareLifecycle =
  | 'pending'      // share-request observed, host has not approved
  | 'approved'     // share event observed; payload may not be fully here
  | 'revoked'      // share-revoked observed (cap reached or manual pull)

export interface ShareState {
  /** Event id of the share-request that originated this share. */
  readonly requestId: string
  /** Event id of the host's `share` event once approved. */
  approvalId: string | null
  /** Pubkey of the member that requested the share. */
  readonly requesterPubkey: string
  /** Display name of the branch (from the request payload). */
  readonly branchName: string
  /** Layer signature of the branch root (from the request payload). */
  readonly branchSig: string
  /** Tile count summary, surfaced in the host's approval modal. */
  readonly tileCount: number | null
  /** Byte estimate, surfaced in the host's approval modal. */
  readonly byteEstimate: number | null
  /** Hierarchy preview (depth-2) for the host's modal. */
  readonly preview: unknown | null
  /** Cap once approved. Null = unlimited. */
  cap: { max: number } | null
  /** Number of `pulled` events observed for this share. */
  pulledCount: number
  /** Lifecycle position. */
  state: ShareLifecycle
  /** Unix seconds the request was first observed. */
  readonly observedAt: number
  /**
   * Inline payload body, present when the requester embedded the
   * content in the share-request itself (v0 click-test path). For full
   * content-addressed sharing, this stays null and the bytes arrive in
   * separate `layer` events keyed by branchSig.
   */
  readonly body: Record<string, unknown> | null
}

export interface JoinRequestState {
  readonly id: string
  readonly pubkey: string
  readonly observedAt: number
}

/**
 * Canonical shape of a paired-channel layer's content. Sig of a layer
 * is `sha256(JSON.stringify(content))` with the keys inserted in this
 * fixed order: name, properties, children. Children are sorted by name
 * before serialisation so two senders building the same subtree
 * compute identical sigs.
 */
export interface PairedLayerContent {
  name: string
  properties: Record<string, unknown>
  children: { name: string; sig: string }[]
}

export interface ChannelState {
  channelId: string
  /** Pubkey of whoever published the channel-announce, or null if not seen. */
  hostPubkey: string | null
  /** Pubkeys with an `admit` event from the host and no later `revoke`. */
  members: Set<string>
  /** Pending join-requests keyed by event id. */
  pendingJoins: Map<string, JoinRequestState>
  /** Shares keyed by request event id. */
  shares: Map<string, ShareState>
  /** Audit verdicts keyed by layerSig → set of auditor pubkeys (approve). */
  audits: { approvals: Map<string, Set<string>>; rejections: Map<string, Set<string>> }
  /**
   * Buffered layer payloads keyed by layer sig. Populated by `layer`
   * verb events; consumed by the receive path when a participant
   * materialises a share. In-memory only — re-fetched from the relay
   * on reload (events live there with their NIP-40 expiration).
   */
  layers: Map<string, PairedLayerContent>
}

// ── transition records ───────────────────────────────────────────────

/**
 * Every `apply()` returns the list of transitions the event caused.
 * Consumers use these to drive UI / side effects (e.g. emit a toast,
 * show an approval modal, start publishing content).
 */
export type Transition =
  | { kind: 'host-elected'; pubkey: string }
  | { kind: 'join-request-received'; id: string; pubkey: string }
  | { kind: 'member-admitted'; pubkey: string }
  | { kind: 'member-revoked'; pubkey: string }
  | { kind: 'share-request-received'; share: ShareState }
  | { kind: 'share-approved'; share: ShareState }
  | { kind: 'share-revoked'; share: ShareState }
  | { kind: 'share-pulled'; share: ShareState; bypubkey: string }
  | { kind: 'layer-received'; sig: string; content: PairedLayerContent }
  | { kind: 'audit-approval'; layerSig: string; auditor: string }
  | { kind: 'audit-rejection'; layerSig: string; auditor: string; danger: string | null }
  | { kind: 'unknown-verb'; type: string }

// ── machine ──────────────────────────────────────────────────────────

export class PairedChannelMachine {

  readonly state: ChannelState

  constructor(channelId: string) {
    this.state = {
      channelId,
      hostPubkey: null,
      members: new Set(),
      pendingJoins: new Map(),
      shares: new Map(),
      audits: { approvals: new Map(), rejections: new Map() },
      layers: new Map(),
    }
  }

  /** Feed a channel event into the machine. Returns the transitions
   *  produced (may be empty for ignored events). */
  apply(event: ChannelEvent): Transition[] {
    if (event.channelId !== this.state.channelId) return []
    const out: Transition[] = []
    const c = this.#payload(event)
    switch (event.type) {
      case 'announce':         out.push(...this.#announce(event)); break
      case 'join':             out.push(...this.#join(event)); break
      case 'admit':            out.push(...this.#admit(event)); break
      case 'revoke':           out.push(...this.#revoke(event)); break
      case 'share-request':    out.push(...this.#shareRequest(event, c)); break
      case 'share':            out.push(...this.#share(event, c)); break
      case 'share-revoked':    out.push(...this.#shareRevoked(event)); break
      case 'pulled':           out.push(...this.#pulled(event)); break
      case 'layer':            out.push(...this.#layer(event, c)); break
      case 'approve':          out.push(...this.#auditApprove(event)); break
      case 'reject':           out.push(...this.#auditReject(event, c)); break
      default:                 out.push({ kind: 'unknown-verb', type: event.type }); break
    }
    return out
  }

  // ── verb handlers ───────────────────────────────────────────────────

  #announce(e: ChannelEvent): Transition[] {
    if (this.state.hostPubkey) return []
    if (!e.pubkey) return []
    this.state.hostPubkey = e.pubkey
    return [{ kind: 'host-elected', pubkey: e.pubkey }]
  }

  #join(e: ChannelEvent): Transition[] {
    if (!e.id || !e.pubkey) return []
    if (this.state.pendingJoins.has(e.id)) return []
    if (this.state.members.has(e.pubkey)) return []
    const join: JoinRequestState = { id: e.id, pubkey: e.pubkey, observedAt: e.createdAt }
    this.state.pendingJoins.set(e.id, join)
    return [{ kind: 'join-request-received', id: e.id, pubkey: e.pubkey }]
  }

  #admit(e: ChannelEvent): Transition[] {
    const target = this.#pTag(e)
    if (!target) return []
    if (e.pubkey !== this.state.hostPubkey) return [] // only host admits
    this.state.members.add(target)
    // any pending joins for this pubkey are resolved
    for (const [id, j] of this.state.pendingJoins) {
      if (j.pubkey === target) this.state.pendingJoins.delete(id)
    }
    return [{ kind: 'member-admitted', pubkey: target }]
  }

  #revoke(e: ChannelEvent): Transition[] {
    const target = this.#pTag(e)
    if (!target) return []
    if (e.pubkey !== this.state.hostPubkey) return []
    if (!this.state.members.has(target)) return []
    this.state.members.delete(target)
    return [{ kind: 'member-revoked', pubkey: target }]
  }

  #shareRequest(e: ChannelEvent, c: Record<string, unknown>): Transition[] {
    if (!e.id || !e.pubkey) return []
    if (this.state.shares.has(e.id)) return []
    const branchSig = stringField(c, 'branchSig') || this.#layerTag(e) || ''
    if (!branchSig) return []
    const branchName = stringField(c, 'name') || stringField(c, 'branchName') || branchSig.slice(0, 8)
    const tileCount = numberField(c, 'tileCount')
    const byteEstimate = numberField(c, 'byteEstimate')
    const preview = (c['preview'] !== undefined ? c['preview'] : null) ?? null
    const body = (c['body'] && typeof c['body'] === 'object' && !Array.isArray(c['body']))
      ? (c['body'] as Record<string, unknown>)
      : null
    const share: ShareState = {
      requestId: e.id,
      approvalId: null,
      requesterPubkey: e.pubkey,
      branchName,
      branchSig,
      tileCount,
      byteEstimate,
      preview,
      cap: null,
      pulledCount: 0,
      state: 'pending',
      observedAt: e.createdAt,
      body,
    }
    this.state.shares.set(e.id, share)
    return [{ kind: 'share-request-received', share }]
  }

  #share(e: ChannelEvent, c: Record<string, unknown>): Transition[] {
    // Reference back to the originating share-request via `e` tag.
    const requestId = this.#eTag(e)
    if (!requestId) return []
    const existing = this.state.shares.get(requestId)
    if (!existing) return []
    if (existing.state !== 'pending') return []
    // Approval is symmetric: either the originating requester
    // self-attests (signed share = "I confirm my own offer") OR a
    // designated host approves on a member's behalf. The mesh
    // subscription (channelId derived from lineage + shared secret)
    // already gates access — the bag IS the trust boundary, no need
    // for a host bottleneck. Self-attest also unblocks stale-host
    // lockout (when a relay retains an announce from a peer who has
    // since gone away).
    if (e.pubkey !== this.state.hostPubkey && e.pubkey !== existing.requesterPubkey) return []
    existing.state = 'approved'
    existing.approvalId = e.id || null
    const capObj = c['cap']
    if (capObj && typeof capObj === 'object') {
      const max = numberField(capObj as Record<string, unknown>, 'maxDownloads')
        ?? numberField(capObj as Record<string, unknown>, 'max')
      if (max !== null && max > 0) existing.cap = { max }
    }
    return [{ kind: 'share-approved', share: existing }]
  }

  #shareRevoked(e: ChannelEvent): Transition[] {
    const refId = this.#eTag(e)
    if (!refId) return []
    const target = this.state.shares.get(refId)
    if (!target) return []
    if (e.pubkey !== this.state.hostPubkey) return []
    if (target.state === 'revoked') return []
    target.state = 'revoked'
    return [{ kind: 'share-revoked', share: target }]
  }

  #pulled(e: ChannelEvent): Transition[] {
    const refId = this.#eTag(e)
    if (!refId || !e.pubkey) return []
    const target = this.state.shares.get(refId)
    if (!target) return []
    target.pulledCount += 1
    return [{ kind: 'share-pulled', share: target, bypubkey: e.pubkey }]
  }

  #layer(e: ChannelEvent, c: Record<string, unknown>): Transition[] {
    // Layer events carry the canonical content of one cell. The
    // identity is in the `layer` tag (the sig). Content payload is
    // the JSON whose hash equals the sig.
    const sig = this.#layerTag(e)
    if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return []
    if (this.state.layers.has(sig)) return [] // already buffered
    const content = parsePairedLayerContent(c)
    if (!content) return []
    this.state.layers.set(sig, content)
    return [{ kind: 'layer-received', sig, content }]
  }

  /** Look up a buffered layer by sig. Returns null if not yet seen. */
  layer(sig: string): PairedLayerContent | null {
    return this.state.layers.get(sig) ?? null
  }

  #auditApprove(e: ChannelEvent): Transition[] {
    const layerSig = this.#layerTag(e)
    if (!layerSig || !e.pubkey) return []
    let bag = this.state.audits.approvals.get(layerSig)
    if (!bag) { bag = new Set(); this.state.audits.approvals.set(layerSig, bag) }
    if (bag.has(e.pubkey)) return []
    bag.add(e.pubkey)
    return [{ kind: 'audit-approval', layerSig, auditor: e.pubkey }]
  }

  #auditReject(e: ChannelEvent, _c: Record<string, unknown>): Transition[] {
    const layerSig = this.#layerTag(e)
    if (!layerSig || !e.pubkey) return []
    let bag = this.state.audits.rejections.get(layerSig)
    if (!bag) { bag = new Set(); this.state.audits.rejections.set(layerSig, bag) }
    if (bag.has(e.pubkey)) return []
    bag.add(e.pubkey)
    let danger: string | null = null
    for (const t of e.tags) {
      if (t[0] === 'danger') { danger = t[1] ?? null; break }
    }
    return [{ kind: 'audit-rejection', layerSig, auditor: e.pubkey, danger }]
  }

  // ── derived selectors ───────────────────────────────────────────────

  /** Pubkeys observed approving the layer. */
  approvalsFor(layerSig: string): ReadonlySet<string> {
    return this.state.audits.approvals.get(layerSig) ?? new Set()
  }
  /** Pubkeys observed rejecting the layer. */
  rejectionsFor(layerSig: string): ReadonlySet<string> {
    return this.state.audits.rejections.get(layerSig) ?? new Set()
  }
  /** True if the given pubkey is currently a member. */
  isMember(pubkey: string): boolean {
    return this.state.members.has(pubkey)
  }
  /** Live shares (approved + pending). Revoked shares are excluded. */
  visibleShares(): ShareState[] {
    return [...this.state.shares.values()].filter(s => s.state !== 'revoked')
  }

  // ── helpers ─────────────────────────────────────────────────────────

  #payload(e: ChannelEvent): Record<string, unknown> {
    if (e.content && typeof e.content === 'object' && !Array.isArray(e.content)) {
      return e.content as Record<string, unknown>
    }
    return {}
  }
  /** First `e=...` tag value. */
  #eTag(e: ChannelEvent): string | null {
    for (const t of e.tags) if (t[0] === 'e' && t[1]) return t[1]
    return null
  }
  /** First `p=...` tag value. */
  #pTag(e: ChannelEvent): string | null {
    for (const t of e.tags) if (t[0] === 'p' && t[1]) return t[1]
    return null
  }
  /** First `layer=...` tag value. */
  #layerTag(e: ChannelEvent): string | null {
    for (const t of e.tags) if (t[0] === 'layer' && t[1]) return t[1]
    return null
  }
}

function stringField(c: Record<string, unknown>, key: string): string | null {
  const v = c[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}
function numberField(c: Record<string, unknown>, key: string): number | null {
  const v = c[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Validate that an arbitrary JSON value matches the PairedLayerContent
 * shape. Returns the canonicalised content (children sorted by name)
 * on success, null on any malformation. The sig the caller computed
 * must be against the canonical form, so receivers re-canonicalise on
 * read to avoid trusting field order from the wire.
 */
export function parsePairedLayerContent(value: unknown): PairedLayerContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const rawName = obj['name']
  const rawProperties = obj['properties']
  const rawChildren = obj['children']
  const name = typeof rawName === 'string' ? rawName : null
  if (!name) return null
  const properties = (rawProperties && typeof rawProperties === 'object' && !Array.isArray(rawProperties))
    ? rawProperties as Record<string, unknown>
    : null
  if (!properties) return null
  const childrenRaw = Array.isArray(rawChildren) ? rawChildren : null
  if (!childrenRaw) return null
  const children: { name: string; sig: string }[] = []
  for (const c of childrenRaw) {
    if (!c || typeof c !== 'object') return null
    const r = c as Record<string, unknown>
    const name = r['name']
    const sig = r['sig']
    if (typeof name !== 'string' || !name) return null
    if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return null
    children.push({ name, sig })
  }
  children.sort((a, b) => a.name.localeCompare(b.name))
  return { name, properties, children }
}

/**
 * Canonical JSON form for layer content. Insertion order is fixed to
 * `{ name, properties, children }` and children are sorted by name.
 * Both sides hash this exact byte sequence, so the resulting sig is
 * stable across implementations as long as they follow this contract.
 */
export function canonicaliseLayerContent(c: PairedLayerContent): string {
  const sorted = [...c.children].sort((a, b) => a.name.localeCompare(b.name))
  // Build the object via property assignment in a fresh object so the
  // V8 / engine insertion order matches our intent.
  const canonical: PairedLayerContent = {
    name: c.name,
    properties: c.properties,
    children: sorted.map(ch => ({ name: ch.name, sig: ch.sig })),
  }
  return JSON.stringify(canonical)
}

/** Compute the layer sig for a content object (sha256 of canonical JSON). */
export async function computeLayerSig(content: PairedLayerContent): Promise<string> {
  const json = canonicaliseLayerContent(content)
  const buf = new TextEncoder().encode(json).buffer as ArrayBuffer
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
