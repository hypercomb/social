// diamondcoreprocessor.com/sharing/paired-channel.drone.ts
//
// Orchestrator for paired-channel sync. Holds one PairedChannelMachine
// per joined channel and pipes incoming events through it. Translates
// machine transitions into EffectBus events for UI consumers, and
// exposes a small API for actions originated by the user (request a
// share, approve a request, pull an approved share).
//
// In-memory only. Protocol events themselves never touch history —
// they're ephemeral, they live on the relay until expiration. The
// only history op produced by sync is the layer-commit that lands
// when a participant accepts an approved share, and that's emitted
// through the same `cell:added` channel everything else uses, not
// through any special protocol-aware path.

import { Drone, EffectBus } from '@hypercomb/core'
import {
  channelIdForLineage,
  type ChannelEvent,
  type ChannelSubscription,
  type ChannelVerb,
  type LineageLike,
  type PairedChannelService,
} from './paired-channel.service.js'
import {
  PairedChannelMachine,
  canonicaliseLayerContent,
  type PairedLayerContent,
  type ShareState,
  type Transition,
} from './paired-channel.machine.js'

const SECRET_STORAGE_KEY = 'hypercomb.paired-channel.secret'
const LOCATION_STORAGE_KEY = 'hypercomb.paired-channel.location'

// EffectBus events emitted to UI consumers.
export const PAIRED_CHANNEL_EFFECTS = {
  joined: 'paired-channel:joined',
  left: 'paired-channel:left',
  hostElected: 'paired-channel:host-elected',
  joinRequestReceived: 'paired-channel:join-request-received',
  memberAdmitted: 'paired-channel:member-admitted',
  shareRequestReceived: 'paired-channel:share-request-received',
  shareApproved: 'paired-channel:share-approved',
  shareRevoked: 'paired-channel:share-revoked',
  sharePulled: 'paired-channel:share-pulled',
  layerReceived: 'paired-channel:layer-received',
  auditApproval: 'paired-channel:audit-approval',
  auditRejection: 'paired-channel:audit-rejection',
} as const

interface JoinedChannel {
  channelId: string
  location: string
  secret: string
  machine: PairedChannelMachine
  subscription: ChannelSubscription
}

export class PairedChannelDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Orchestrator for paired-channel sync. One state machine per joined channel; ephemeral protocol state, only materialised layers reach history.'

  public override grammar = [{ example: 'paired-channel join' }]

  public override effects = [] as const

  // No special listens — the drone subscribes to the mesh directly via
  // PairedChannelService, not via the EffectBus.
  protected override listens: string[] = []

  protected override emits: string[] = Object.values(PAIRED_CHANNEL_EFFECTS)

  // ── state ─────────────────────────────────────────────────────────

  readonly #channels = new Map<string, JoinedChannel>()

  // ── lifecycle ─────────────────────────────────────────────────────

  /**
   * Drone heartbeat — runs on every pulse. v0: reads a single
   * (location, secret) from localStorage and auto-joins. The location
   * is parsed into segments and signed identically to how
   * HistoryService.sign would sign it, so the channelId aligns with
   * the canonical lineage signature. Settings UI lands later.
   * Idempotent: re-joining is a no-op once the channel is in
   * #channels.
   */
  public override heartbeat = async (): Promise<void> => {
    if (this.#channels.size > 0) return
    const location = readLocalStorage(LOCATION_STORAGE_KEY)
    const secret = readLocalStorage(SECRET_STORAGE_KEY)
    if (!location || !secret) return
    await this.join(location, secret)
  }

  /**
   * Join a channel by `(location, secret)`. The location is a path
   * string like `/howard/team` — parsed into segments, then signed
   * via HistoryService.sign (or the equivalent fallback) and combined
   * with the secret to produce the channelId.
   *
   * Idempotent: re-joining the same pair is a no-op. Returns the
   * channelId on success, null on failure.
   */
  async join(location: string, secret: string): Promise<string | null> {
    const lineage: LineageLike = {
      explorerSegments: () => parseLocationSegments(location),
    }
    let channelId: string
    try { channelId = await channelIdForLineage(lineage, secret) }
    catch (err) { console.warn('[paired-channel] join: derivation failed', err); return null }

    if (this.#channels.has(channelId)) return channelId

    const service = this.#service()
    if (!service) {
      console.warn('[paired-channel] join: PairedChannelService not available')
      return null
    }

    const machine = new PairedChannelMachine(channelId)
    const subscription = service.subscribe(channelId, (event) => {
      this.#onChannelEvent(channelId, event)
    })

    const joined: JoinedChannel = { channelId, location, secret, machine, subscription }
    this.#channels.set(channelId, joined)
    EffectBus.emit(PAIRED_CHANNEL_EFFECTS.joined, { channelId, location })
    // Publish announce so this client's pubkey becomes a candidate
    // host. The state machine's #announce handler accepts only the
    // first announce it observes; later announces are no-ops. In
    // single-user multi-tab scenarios both tabs publish the same
    // pubkey, so whoever lands first claims the host slot and both
    // tabs treat themselves as the host (auto-approve their own
    // share-requests).
    void this.#announceIfNeeded(channelId)
    return channelId
  }

  /**
   * Join a channel using a fully-formed Lineage object (typically
   * `@hypercomb.social/Lineage`). Use this in code paths that already
   * hold the live lineage so the channelId aligns exactly with the
   * lineage's canonical signature.
   */
  async joinLineage(lineage: LineageLike, secret: string): Promise<string | null> {
    let channelId: string
    try { channelId = await channelIdForLineage(lineage, secret) }
    catch (err) { console.warn('[paired-channel] joinLineage: derivation failed', err); return null }
    if (this.#channels.has(channelId)) return channelId
    const service = this.#service()
    if (!service) return null
    const machine = new PairedChannelMachine(channelId)
    const subscription = service.subscribe(channelId, (event) => this.#onChannelEvent(channelId, event))
    const segments = lineage.explorerSegments?.() ?? []
    const location = '/' + segments.join('/')
    this.#channels.set(channelId, { channelId, location, secret, machine, subscription })
    EffectBus.emit(PAIRED_CHANNEL_EFFECTS.joined, { channelId, location })
    void this.#announceIfNeeded(channelId)
    return channelId
  }

  /**
   * Publish a `type=announce` event after a short delay if no host
   * has been observed yet. The delay lets late-arriving announces
   * from existing peers be processed first — if someone else already
   * claimed the host slot, we don't fight them for it.
   */
  async #announceIfNeeded(channelId: string): Promise<void> {
    // Tiny delay so any retained announces from the relay arrive first.
    await new Promise(r => setTimeout(r, 300))
    const machine = this.#channels.get(channelId)?.machine
    if (!machine) return
    if (machine.state.hostPubkey) return // someone announced already
    const service = this.#service()
    if (!service) return
    await service.publish(channelId, 'announce', { auditPolicy: { threshold: 1, trustedSet: [] } })
  }

  /** Leave a channel. Closes the subscription and drops in-memory state. */
  leave(channelId: string): void {
    const joined = this.#channels.get(channelId)
    if (!joined) return
    try { joined.subscription.close() } catch { /* best-effort */ }
    this.#channels.delete(channelId)
    EffectBus.emit(PAIRED_CHANNEL_EFFECTS.left, { channelId })
  }

  /** All currently-joined channelIds. */
  joinedChannels(): readonly string[] {
    return [...this.#channels.keys()]
  }

  /** Read-only view of a joined channel's machine state. */
  stateOf(channelId: string): PairedChannelMachine | null {
    return this.#channels.get(channelId)?.machine ?? null
  }

  // ── public API for callers (expose drone, accept toast, etc.) ─────

  /**
   * Publish a `share-request` for the given branch on a joined channel.
   * The host's machine sees it, decides per its rules, and (in v0)
   * auto-publishes a `share` event. Other participants see the
   * approved share and can pull.
   *
   * `body` is the inline payload for v0 (a tile's properties + name).
   * Real subtree sharing uses separate `layer` events keyed by sig;
   * this drone delegates that lookup to the consumer.
   */
  async requestShare(
    channelId: string,
    payload: {
      branchSig: string
      branchName: string
      tileCount?: number | null
      byteEstimate?: number | null
      preview?: unknown
      body?: Record<string, unknown> | null
    },
  ): Promise<boolean> {
    const service = this.#service()
    if (!service) return false
    const tags = [['layer', payload.branchSig]]
    return service.publish(channelId, 'share-request', payload, tags)
  }

  /**
   * Approve a pending share-request as the host. Caller looks up the
   * `requestId` from `stateOf(channelId).visibleShares()` and (optionally)
   * sets a `cap.maxDownloads`. Publishes the `share` event the
   * participants are waiting for.
   */
  async approveShare(
    channelId: string,
    requestId: string,
    cap: number | null = null,
  ): Promise<boolean> {
    const machine = this.#channels.get(channelId)?.machine
    if (!machine) return false
    const share = machine.state.shares.get(requestId)
    if (!share || share.state !== 'pending') return false
    const service = this.#service()
    if (!service) return false
    const payload: Record<string, unknown> = {}
    if (cap !== null && cap > 0) payload['cap'] = { maxDownloads: cap }
    return service.publish(
      channelId,
      'share',
      payload,
      [['e', requestId], ['layer', share.branchSig], ['p', share.requesterPubkey]],
    )
  }

  /**
   * Mark an approved share as pulled. Publishes the `pulled` event
   * for the host's cap counter. Callers materialise the actual content
   * separately — usually by reading the inline `body` from the
   * matching ShareState, or fetching `layer` events keyed by branchSig.
   */
  async markPulled(channelId: string, approvalId: string): Promise<boolean> {
    const service = this.#service()
    if (!service) return false
    return service.publish(channelId, 'pulled', {}, [['e', approvalId]])
  }

  /**
   * If we are the host of `channelId` AND the share was requested by
   * the host (us), auto-approve it without waiting for a UI prompt.
   * Member-initiated requests fall through and surface the prompt.
   *
   * Host identity is determined by comparing our NostrSigner pubkey
   * to the channel's `hostPubkey` (set by whoever published the first
   * `announce`).
   */
  async #maybeAutoApprove(channelId: string, share: ShareState): Promise<void> {
    const machine = this.#channels.get(channelId)?.machine
    if (!machine) return
    const hostPubkey = machine.state.hostPubkey
    if (!hostPubkey) return // no announce yet
    if (share.requesterPubkey !== hostPubkey) return // member request → need manual allow
    const myPubkey = await this.#myPubkey()
    if (!myPubkey) return
    if (myPubkey !== hostPubkey) return // someone else is host
    void this.approveShare(channelId, share.requestId, null)
  }

  async #myPubkey(): Promise<string | null> {
    if (this.#cachedMyPubkey) return this.#cachedMyPubkey
    const signer = window.ioc.get('@diamondcoreprocessor.com/NostrSigner') as
      { getPublicKeyHex?: () => Promise<string | null> } | undefined
    if (!signer?.getPublicKeyHex) return null
    const pk = await signer.getPublicKeyHex()
    if (pk) this.#cachedMyPubkey = pk
    return pk
  }
  #cachedMyPubkey: string | null = null

  /**
   * Publish one cell's canonical layer content. Caller pre-computed
   * `sig` via `computeLayerSig(content)`; this method just sends it.
   * Idempotent on the relay side (event id uniqueness), so re-publishes
   * are safe.
   */
  async publishLayer(
    channelId: string,
    sig: string,
    content: PairedLayerContent,
  ): Promise<boolean> {
    const service = this.#service()
    if (!service) return false
    // Send the canonical content as a string so the receiver hashes
    // exactly the bytes we hashed. Receivers will re-canonicalise on
    // parse, but sending bytes that already match the sig keeps the
    // wire form auditable (sig === sha256(content)).
    const json = canonicaliseLayerContent(content)
    return service.publish(channelId, 'layer', JSON.parse(json), [['layer', sig]])
  }

  /** Look up a buffered layer by sig (returns null if not yet seen). */
  layerOf(channelId: string, sig: string): PairedLayerContent | null {
    return this.#channels.get(channelId)?.machine.layer(sig) ?? null
  }

  /**
   * Walk a share's branchSig recursively from the layer buffer and
   * materialise each layer at the matching path under `parentDir`.
   * Returns `{ written, missing }` so the caller can decide whether
   * to surface "incomplete" or wait for more `layer` events.
   *
   * Cell content lands in 0000 (via writeCellProperties); folder names
   * come from the layer's `name` field. Cycles are guarded by a
   * visited-set keyed by sig.
   *
   * Two modes:
   *   `mode: 'create'` (default — `sync` semantics)
   *     - Cell didn't exist  → create, write 0000, emit cell:added
   *     - Cell already exists → overwrite 0000 with incoming properties
   *
   *   `mode: 'merge'` (— `merge` semantics)
   *     - Cell didn't exist  → create, write 0000, emit cell:added
   *     - Cell already exists → shallow-merge: existing ← incoming,
   *                             incoming wins on key conflicts.
   *                             Children are unioned via recursion
   *                             (no destructive overwrite of locals
   *                             that aren't in the incoming set).
   *
   * In both modes, brand-new cells emit `cell:added` so the receiver's
   * HistoryRecorder logs the addition. Existing-and-merged cells emit
   * no add (they were already present).
   */
  async materialiseFromSig(
    channelId: string,
    sig: string,
    parentDir: FileSystemDirectoryHandle,
    opts: { mode?: 'create' | 'merge' } = {},
  ): Promise<{ written: number; missing: string[] }> {
    const mode = opts.mode ?? 'create'
    const machine = this.#channels.get(channelId)?.machine
    if (!machine) return { written: 0, missing: [sig] }
    const visited = new Set<string>()
    const missing: string[] = []
    let written = 0

    const walk = async (s: string, dir: FileSystemDirectoryHandle, parentSegments: readonly string[]): Promise<void> => {
      if (visited.has(s)) return
      visited.add(s)
      const content = machine.layer(s)
      if (!content) { missing.push(s); return }

      // Probe for existence first so we can distinguish "new" (emit
      // cell:added) from "existing" (don't double-record).
      let existed = true
      try { await dir.getDirectoryHandle(content.name, { create: false }) }
      catch { existed = false }

      let cellDir: FileSystemDirectoryHandle
      try { cellDir = await dir.getDirectoryHandle(content.name, { create: true }) }
      catch (err) { console.warn('[paired-channel] materialise: getDirectoryHandle failed', content.name, err); return }

      // Resolve the properties to write based on mode.
      let propsToWrite: Record<string, unknown>
      if (!existed) {
        // New cell — incoming props are the full body.
        propsToWrite = { ...content.properties }
      } else if (mode === 'merge') {
        // Shallow merge — incoming wins on key conflicts, but local
        // keys not present in incoming survive.
        const { readCellProperties } = await import('../editor/tile-properties.js')
        const existing = await readCellProperties(cellDir).catch(() => ({} as Record<string, unknown>))
        propsToWrite = { ...existing, ...content.properties }
      } else {
        // Create mode against an existing cell — overwrite.
        propsToWrite = { ...content.properties }
      }

      try {
        await this.#writeProperties(cellDir, propsToWrite)
      } catch (err) {
        console.warn('[paired-channel] materialise: write 0000 failed', content.name, err)
      }
      written++

      // Emit cell:added so HistoryRecorder logs the add. Only on truly
      // new cells — re-emitting for existing cells would create
      // bogus history entries.
      if (!existed) {
        EffectBus.emit('cell:added', { cell: content.name, segments: [...parentSegments] })
      }

      // Recurse into children. Pass the current segments + this cell's
      // name for nested cell:added emissions.
      const childSegments = [...parentSegments, content.name]
      for (const child of content.children) {
        await walk(child.sig, cellDir, childSegments)
      }
    }

    await walk(sig, parentDir, [])
    return { written, missing }
  }

  // Lazy-imported to avoid a hard dependency cycle from the drone into
  // the editor module — and so this drone can be used from a node test
  // harness without an editor present.
  async #writeProperties(
    cellDir: FileSystemDirectoryHandle,
    properties: Record<string, unknown>,
  ): Promise<void> {
    const { writeCellProperties } = await import('../editor/tile-properties.js')
    await writeCellProperties(cellDir, properties)
  }

  // ── internal: event routing & rules ───────────────────────────────

  #onChannelEvent(channelId: string, event: ChannelEvent): void {
    const joined = this.#channels.get(channelId)
    if (!joined) return
    const transitions = joined.machine.apply(event)
    for (const t of transitions) this.#onTransition(channelId, t)
  }

  #onTransition(channelId: string, t: Transition): void {
    switch (t.kind) {
      case 'host-elected':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.hostElected, { channelId, pubkey: t.pubkey })
        break
      case 'join-request-received':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.joinRequestReceived, { channelId, id: t.id, pubkey: t.pubkey })
        break
      case 'member-admitted':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.memberAdmitted, { channelId, pubkey: t.pubkey })
        break
      case 'member-revoked':
        // We don't currently advertise an effect for revoke — re-uses memberAdmitted with a kind tag if needed.
        break
      case 'share-request-received':
        // Asymmetric approval. If the requester IS the host (sharing
        // their own node), auto-approve — no UI prompt, the share
        // event goes out immediately. If the requester is a member,
        // surface a prompt; only host's published `share` event takes
        // effect, so non-host clicks would be no-ops anyway.
        //
        // We still emit the UI effect for the host-self case so any
        // surface that wants to "exposed → toast" feedback can hook
        // it; auto-approve simply also fires.
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.shareRequestReceived, { channelId, share: t.share })
        void this.#maybeAutoApprove(channelId, t.share)
        break
      case 'share-approved':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.shareApproved, { channelId, share: t.share })
        break
      case 'share-revoked':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.shareRevoked, { channelId, share: t.share })
        break
      case 'share-pulled':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.sharePulled, { channelId, share: t.share, by: t.bypubkey })
        break
      case 'layer-received':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.layerReceived, { channelId, sig: t.sig, content: t.content })
        break
      case 'audit-approval':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.auditApproval, { channelId, layerSig: t.layerSig, auditor: t.auditor })
        break
      case 'audit-rejection':
        EffectBus.emit(PAIRED_CHANNEL_EFFECTS.auditRejection, { channelId, layerSig: t.layerSig, auditor: t.auditor, danger: t.danger })
        break
      case 'unknown-verb':
        // Silently ignore unknown verbs — forward-compatible by design.
        break
    }
  }


  #service(): PairedChannelService | null {
    const svc = window.ioc.get(
      '@diamondcoreprocessor.com/PairedChannelService',
    ) as PairedChannelService | undefined
    return svc ?? null
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function readLocalStorage(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key)
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * Mirror HistoryService.sign's segment-extraction step so the location
 * we feed into channelIdForLineage produces the same lineage sig that
 * the rest of the system would derive for this path.
 */
function parseLocationSegments(location: string): string[] {
  return String(location ?? '')
    .split('/')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

// ── registration ─────────────────────────────────────────────────────

const _pairedChannelDrone = new PairedChannelDrone()
window.ioc.register('@diamondcoreprocessor.com/PairedChannelDrone', _pairedChannelDrone)

// Suppress unused warnings for verbs that callers will use elsewhere.
const _verbs: ChannelVerb[] = ['announce', 'join', 'admit', 'revoke', 'share-request', 'share', 'share-revoked', 'pulled', 'layer', 'node', 'audit-needed', 'approve', 'reject', 'auditors']
void _verbs
void ({} as ShareState)
