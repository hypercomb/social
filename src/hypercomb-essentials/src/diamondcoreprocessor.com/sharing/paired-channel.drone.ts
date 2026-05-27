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
import { ephemeralTileSource } from '../presentation/tiles/sources/ephemeral-tile.source.js'
import {
  TILE_SOURCE_REGISTRY_KEY,
  type TileSourceRegistry,
} from '../presentation/tiles/tile-source-registry.js'

// Canonical store keys — the same ones the rest of the mesh layer
// reads. Drone tracks the live values so navigation changes drive
// channel rejoin automatically. The mesh contract is room + lineage
// + secret; the drone reads all three from the canonical stores.
const ROOM_STORE_KEY = '@hypercomb.social/RoomStore'
const SECRET_STORE_KEY = '@hypercomb.social/SecretStore'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

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

  // The drone reads channel events directly via PairedChannelService.
  // `fs:changed` / `cell:added` / `cell:removed` are subscribed for
  // re-evaluation triggers (navigation, structural mutations) — these
  // are the only EffectBus signals the drone cares about.
  protected override listens: string[] = ['fs:changed', 'cell:added', 'cell:removed']

  constructor() {
    super()
    // Register the ephemeral tile source with the TileSourceRegistry.
    // Show-cell unions all registered sources to decide what tiles to
    // render at the current location; this is how preview tiles surface
    // without show-cell having to know anything about sync. The source
    // is a pure read of #ephemeralShares, so it's safe to register
    // synchronously even before the first channel is joined — it just
    // returns [] until shares appear.
    //
    // Lazy resolve of the registry: it lives in IoC and may not be
    // registered yet at drone-construction time (essentials module load
    // order varies). Retry briefly, then give up — the registry being
    // absent means render is also absent (no consumer), which is fine.
    const tryRegisterEphemeralSource = (attempts: number): void => {
      const registry = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
        TILE_SOURCE_REGISTRY_KEY,
      ) as TileSourceRegistry | undefined
      if (registry?.register) {
        registry.register(ephemeralTileSource)
        return
      }
      if (attempts > 0) setTimeout(() => tryRegisterEphemeralSource(attempts - 1), 50)
    }
    tryRegisterEphemeralSource(40) // ~2s
    // Wire EffectBus listeners IMMEDIATELY at construction. The drone
    // heartbeat only fires on `hypercomb().act()` (command-line,
    // clipboard, etc.) — it does not fire on page boot. If we waited
    // for the first heartbeat to register listeners, any cell:added
    // emitted before that first pulse would be lost. The act() that
    // typically follows an add fires AFTER cell:added, so the
    // first-pulse path is permanently late.
    //
    // EffectBus is keyed by event name; multiple onEffect registrations
    // for the same key from the same bee don't stack, so subsequent
    // setup paths (heartbeat) won't duplicate handlers.
    const reEval = () => { void this.#reEvaluateChannel() }
    this.onEffect('fs:changed', reEval)
    this.onEffect('cell:removed', reEval)
    // cell:added has to await the channel join before broadcasting:
    // on a cold-loaded receiver, the FIRST cell:added it sees might
    // be the user adding a tile right after page boot — its drone
    // hasn't joined a channel yet, so #onLocalCellAdded would find
    // `joinedChannels: []` and silently no-op. Awaiting reEvaluate
    // first ensures the channel is live before we decide whether to
    // re-broadcast.
    this.onEffect<{ cell?: string; segments?: readonly string[]; source?: string }>('cell:added', async (payload) => {
      if (payload?.source === 'paired-channel') return
      await this.#reEvaluateChannel()
      void this.#onLocalCellAdded(payload)
    })
    // Hook the Lineage's 'change' event lazily — the Lineage might
    // not be registered yet at module-load time. Poll briefly then
    // attach. Also poll a few times to FIRE reEval until the drone
    // has joined a channel — this is the boot-time join because
    // neither lineage 'change' nor cell:added might fire before the
    // user's first action.
    const tryWireLineage = (attempts: number) => {
      const lineage = window.ioc?.get?.(LINEAGE_KEY) as
        (EventTarget & { addEventListener: EventTarget['addEventListener'] }) | undefined
      if (lineage?.addEventListener) {
        lineage.addEventListener('change', reEval)
        return
      }
      if (attempts > 0) setTimeout(() => tryWireLineage(attempts - 1), 100)
    }
    tryWireLineage(50) // up to ~5s

    // Active boot-time join: poll reEvaluate every 250ms for up to
    // ~10s, stopping once we have at least one channel joined. This
    // covers the cold-start case where no event fires before the
    // user's first action but the credentials are already in
    // localStorage.
    const tryInitialJoin = async (attempts: number): Promise<void> => {
      if (this.#channels.size > 0) return
      await this.#reEvaluateChannel()
      if (this.#channels.size > 0) return
      if (attempts > 0) setTimeout(() => { void tryInitialJoin(attempts - 1) }, 250)
    }
    void tryInitialJoin(40)
  }

  protected override emits: string[] = Object.values(PAIRED_CHANNEL_EFFECTS)

  // ── state ─────────────────────────────────────────────────────────

  readonly #channels = new Map<string, JoinedChannel>()

  // Boot timestamp (seconds) for the channel-event freshness gate. Any
  // ChannelEvent with createdAt older than (#sessionBootSec - GRACE) is
  // dropped before reaching the state machine. Rationale: dev relay
  // (and most public relays) cache past-session events and replay them
  // on subscribe, so a fresh session joining an existing channel would
  // otherwise auto-materialise dozens of ephemeral facades for shares
  // that were posted months ago. The gate keeps the boot view quiet
  // and only lets through events from live, currently-publishing peers.
  // Grace window is twice the swarm heartbeat (60s) to tolerate clock
  // skew + a missed heartbeat without dropping live peers.
  readonly #sessionBootSec = Math.floor(Date.now() / 1000)
  static readonly CHANNEL_EVENT_GRACE_SEC = 60

  /**
   * Bumped while materialiseFromSig is writing to OPFS. Reserved for
   * future use (e.g. a cell:added listener that re-broadcasts local
   * adds — needs this to suppress echo when the "add" came from the
   * sync write itself).
   */
  #materialiseInProgress = 0

  // ── lifecycle ─────────────────────────────────────────────────────

  /**
   * Drone heartbeat — runs on every pulse. Reads the user's ACTUAL
   * secret (`SecretStore.value` = `hc:secret`) and the LIVE lineage
   * (`@hypercomb.social/Lineage`), then ensures we're subscribed to
   * the channel that matches the current navigation + secret.
   *
   * No invented localStorage keys, no static config — the drone
   * follows wherever you navigate.
   *
   * Guards:
   *  - NostrMeshDrone must be registered (load-order race on cold
   *    start; without this, subscribe returns a no-op and wedges the
   *    drone permanently).
   *  - SecretStore must have a value (no secret = no channel).
   *  - Lineage must expose `explorerSegments`.
   *
   * Navigation switching: if the live lineage's channelId differs
   * from what we're currently subscribed to, leave the old channel
   * and join the new one. One active channel = current bag.
   */
  public override heartbeat = async (): Promise<void> => {
    // Listeners are wired in the constructor; the heartbeat just
    // re-evaluates the desired channel. (Heartbeat still useful as a
    // safety net for navigation switching when no other event fires.)
    await this.#reEvaluateChannel()
  }

  /**
   * Live re-broadcast on local cell:added.
   *
   * - Skip if the cell:added came from materialise itself (echo guard
   *   via `#materialiseInProgress`).
   * - Find any joined channel whose recorded location matches the
   *   cell's PARENT lineage. If none, do nothing — the cell was added
   *   somewhere we're not currently syncing.
   * - Fire `tile:action expose` for that cell. expose.drone walks the
   *   subtree, publishes layer events, publishes share-request. The
   *   sender's own #maybeAutoApprove (if host) elevates it to a share.
   *
   * Channels store `location` as the slash-joined segments string. We
   * compare normalised paths so the matcher works regardless of any
   * leading/trailing slashes.
   */
  async #onLocalCellAdded(payload: { cell?: string; segments?: readonly string[] }): Promise<void> {
    if (this.#materialiseInProgress > 0) return
    const cellName = payload?.cell
    if (typeof cellName !== 'string' || cellName.length === 0) return
    // Resolve parent lineage. Some emit sites pass `segments`
    // explicitly (clipboard, claude-bridge); the canonical add path
    // (slash-behavior) does not — so fall back to the LIVE lineage
    // segments. Without this fallback, an add at /dolphin would be
    // attributed to / and never match any channel rooted at /dolphin.
    let segments: readonly string[]
    if (Array.isArray(payload?.segments)) {
      segments = payload!.segments!
    } else {
      const lineage = window.ioc.get(LINEAGE_KEY) as LineageLike | undefined
      segments = lineage?.explorerSegments?.() ?? []
    }
    const targetSegs = segments.map(s => String(s ?? '').trim()).filter(Boolean).join('/')
    let matched = false
    for (const joined of this.#channels.values()) {
      const here = parseLocationSegments(joined.location).join('/')
      if (here === targetSegs) { matched = true; break }
    }
    if (!matched) {
      console.log('[sync] cell:added: no channel matches parent', { cell: cellName, parent: '/' + targetSegs, joinedChannels: [...this.#channels.values()].map(j => j.location) })
      return
    }
    console.log('[sync] cell:added → expose', { cell: cellName, parent: '/' + targetSegs })
    EffectBus.emit('tile:action', { action: 'expose', label: cellName, q: 0, r: 0, index: 0 })
  }

  /**
   * Compute the current desired channelId from live state, then join /
   * leave so the drone is always subscribed to exactly the channel
   * matching the user's current navigation + secret. Re-entrant safe
   * (joinLineage is idempotent on dedup).
   */
  async #reEvaluateChannel(): Promise<void> {
    const mesh = window.ioc.get('@diamondcoreprocessor.com/NostrMeshDrone') as
      { isNetworkEnabled?: () => boolean } | undefined
    if (!mesh) return // mesh drone not registered yet

    // Hard privacy gate: if the user has mesh set to private, the paired
    // channel must not join channels or rebroadcast local cells.
    // Without this gate, having a `hc:secret` set was enough to trigger
    // `joinLineage` + `#broadcastExistingCellsAt`, which emits
    // `tile:action expose` for every local cell — surfacing "Exposed"
    // toasts and putting layer sigs into the channel even though the
    // user explicitly stayed private. Mesh.isNetworkEnabled() is the
    // single source of truth for "may we touch the wire."
    if (typeof mesh.isNetworkEnabled === 'function' && !mesh.isNetworkEnabled()) {
      if (this.#channels.size > 0) {
        console.log('[sync] heartbeat: mesh private, leaving all channels')
        for (const cid of [...this.#channels.keys()]) this.leave(cid)
      }
      return
    }

    const secretStore = window.ioc.get(SECRET_STORE_KEY) as { value?: string } | undefined
    const secret = String(secretStore?.value ?? '').trim()
    if (!secret) {
      // Secret cleared → drop every channel.
      if (this.#channels.size > 0) {
        console.log('[sync] heartbeat: secret cleared, leaving all channels')
        for (const cid of [...this.#channels.keys()]) this.leave(cid)
      }
      return
    }

    const roomStore = window.ioc.get(ROOM_STORE_KEY) as { value?: string } | undefined
    const room = String(roomStore?.value ?? '').trim()

    const lineage = window.ioc.get(LINEAGE_KEY) as LineageLike | undefined
    if (!lineage?.explorerSegments) return

    let desiredChannelId: string
    try { desiredChannelId = await channelIdForLineage(lineage, room, secret) }
    catch (err) { console.warn('[sync] channel derivation failed', err); return }

    if (this.#channels.has(desiredChannelId)) return

    const segments = lineage.explorerSegments?.() ?? []
    console.log('[sync] heartbeat: joining channel', {
      channelId: desiredChannelId.slice(0, 12),
      room,
      lineage: '/' + segments.join('/'),
      secretSet: !!secret,
    })
    // Lineage / secret changed — leave any stale channels first.
    for (const oldChannelId of [...this.#channels.keys()]) {
      if (oldChannelId !== desiredChannelId) {
        console.log('[sync] heartbeat: leaving stale channel', oldChannelId.slice(0, 12))
        this.leave(oldChannelId)
      }
    }
    // Sweep disabled — received cells now install as permanent, so
    // there are no transient markers to clean up. Old transient
    // markers from prior sessions get a free pass; if they collide
    // with newly-arrived sigs, the existing-tile guard in
    // #materialiseFacade ('share: tile already exists locally, skipping')
    // handles it.
    await this.joinLineage(lineage, room, secret)
    // After join: broadcast pre-existing real cells at this lineage so
    // peers receive them as transient. Without this, sync only flows
    // for cells added AFTER the channel is live — existing tiles are
    // invisible to the other side. Skip cells flagged transient (they
    // came from the channel; rebroadcasting them is echo).
    void this.#broadcastExistingCellsAt(lineage)
  }

  /**
   * Broadcast existing cells at this lineage so peers receive them as
   * transient previews. PENDING re-wire: this used to read OPFS folders
   * and consult per-tile 0000 for the `transient` echo-guard flag. With
   * the layer-primitive doctrine those folders no longer exist; the
   * authoritative list comes from layer.children + the optimization
   * substrate for transient state. No-op until a layer-read enumeration
   * API is wired in.
   */
  async #broadcastExistingCellsAt(
    _lineage: LineageLike & { explorerDir?: () => Promise<FileSystemDirectoryHandle | null> },
  ): Promise<void> {
    /* no-op pending layer-children read path */
  }

  /**
   * Sweep transient cells at this lineage. PENDING re-wire: legacy
   * implementation walked OPFS, read each cell's 0000 for the
   * `transient:true` marker, and removed matching folders. Both the
   * folder layout and the 0000-based marker are retired under the
   * layer-primitive doctrine — transient state should live in the
   * optimization substrate, not in the canonical layer. No-op until
   * that substrate read + tombstone-via-children-slot path is wired.
   */
  async #sweepTransientCellsAt(_lineage: LineageLike & { explorerDir?: () => Promise<FileSystemDirectoryHandle | null> }): Promise<void> {
    /* no-op pending optimization-substrate transient marker path */
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
  async join(location: string, secret: string, room: string = ''): Promise<string | null> {
    const lineage: LineageLike = {
      explorerSegments: () => parseLocationSegments(location),
    }
    let channelId: string
    try { channelId = await channelIdForLineage(lineage, room, secret) }
    catch (err) { console.warn('[paired-channel] join: derivation failed', err); return null }

    if (this.#channels.has(channelId)) return channelId

    const service = this.#service()
    if (!service) {
      console.warn('[paired-channel] join: PairedChannelService not available')
      return null
    }
    // Belt-and-suspenders: NostrMeshDrone must be registered before
    // we attempt subscribe. If it isn't, abort the join entirely so
    // the heartbeat retries on the next pulse — better than leaving
    // a half-committed JoinedChannel with a no-op subscription.
    if (!window.ioc.get('@diamondcoreprocessor.com/NostrMeshDrone')) {
      console.warn('[paired-channel] join: NostrMeshDrone not registered yet, will retry')
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
  async joinLineage(lineage: LineageLike, room: string, secret: string): Promise<string | null> {
    let channelId: string
    try { channelId = await channelIdForLineage(lineage, room, secret) }
    catch (err) { console.warn('[sync] joinLineage: derivation failed', err); return null }
    if (this.#channels.has(channelId)) return channelId
    const service = this.#service()
    if (!service) return null
    const machine = new PairedChannelMachine(channelId)
    const subscription = service.subscribe(channelId, (event) => this.#onChannelEvent(channelId, event))
    const segments = lineage.explorerSegments?.() ?? []
    const location = '/' + segments.join('/')
    this.#channels.set(channelId, { channelId, location, secret, machine, subscription })
    console.log('[sync] joined channel', { channelId: channelId.slice(0, 12), location, room })
    EffectBus.emit(PAIRED_CHANNEL_EFFECTS.joined, { channelId, location, room })
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

  /**
   * Ephemeral shares at a given lineage location, deduplicated by
   * branchName. Returned values include the branchSig so consumers
   * can later call `materialiseFromSig` to commit.
   *
   * Used by show-cell to render preview tiles at the receiver's
   * current bag without touching OPFS. Adopt is the only path that
   * commits — after that the cell lands in OPFS and renders
   * normally, and the ephemeral entry should be cleared via
   * `clearEphemeral`.
   */
  ephemeralSharesAt(location: string): { branchName: string; branchSig: string; channelId: string; approvalId: string | null }[] {
    const target = parseLocationSegments(location).join('/')
    const out: { branchName: string; branchSig: string; channelId: string; approvalId: string | null }[] = []
    const seen = new Set<string>()
    for (const entry of this.#ephemeralShares) {
      if (entry.location !== target) continue
      if (seen.has(entry.branchName)) continue
      seen.add(entry.branchName)
      out.push({ branchName: entry.branchName, branchSig: entry.branchSig, channelId: entry.channelId, approvalId: entry.approvalId })
    }
    return out
  }

  /** Record an ephemeral share (called when materialiseFacade fires). */
  recordEphemeralShare(payload: { channelId: string; location: string; branchName: string; branchSig: string; approvalId: string | null }): void {
    const normalised = parseLocationSegments(payload.location).join('/')
    // Dedupe on (channelId, branchName) — incoming retransmits don't
    // double up.
    const exists = this.#ephemeralShares.find(e =>
      e.channelId === payload.channelId && e.branchName === payload.branchName
    )
    if (exists) return
    this.#ephemeralShares.push({
      channelId: payload.channelId,
      location: normalised,
      branchName: payload.branchName,
      branchSig: payload.branchSig,
      approvalId: payload.approvalId,
    })
  }

  /** Clear an ephemeral share once it's committed to OPFS via adopt. */
  clearEphemeralShare(branchName: string): void {
    this.#ephemeralShares = this.#ephemeralShares.filter(e => e.branchName !== branchName)
  }

  /** Internal storage. One entry per (channel, branchName) pair. */
  #ephemeralShares: { channelId: string; location: string; branchName: string; branchSig: string; approvalId: string | null }[] = []

  /**
   * Import — flip `transient: true` off on a cell + every descendant.
   * After import the cell survives reload (the boot sweep no longer
   * sees it). Idempotent: importing a non-transient cell is a no-op.
   */
  async importTransientTree(cellName: string): Promise<{ cleared: number }> {
    const lineage = window.ioc.get(LINEAGE_KEY) as LineageLike | undefined
    const parentSegments = (lineage as { explorerSegments?: () => readonly string[] } | undefined)?.explorerSegments?.() ?? []
    const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService') as
      { getLayerBySig?: (s: string) => Promise<{ name?: string; children?: readonly unknown[] } | null> } | undefined
    const { readTilePropertiesAt, writeTilePropertiesAt } = await import('../editor/tile-properties.js')
    let cleared = 0
    // Walk the cell's layer tree (canonical), not the OPFS dir tree.
    // The layer's children array holds child layer sigs; resolve each
    // to its layer JSON to get its name, then recurse. Same shape as
    // the old OPFS walk but driven by the merkle tree.
    const walk = async (segments: readonly string[], name: string, layerSig?: string): Promise<void> => {
      try {
        const props = await readTilePropertiesAt(segments, name).catch(() => ({} as Record<string, unknown>))
        if (props['transient'] === true) {
          await writeTilePropertiesAt(segments, name, { transient: false })
          cleared++
        }
        if (!history?.getLayerBySig || !layerSig) return
        const layer = await history.getLayerBySig(layerSig)
        const childSigs = (layer && Array.isArray(layer.children) ? layer.children : []) as readonly unknown[]
        for (const cs of childSigs) {
          if (typeof cs !== 'string') continue
          const childLayer = await history.getLayerBySig(cs)
          const childName = typeof childLayer?.name === 'string' ? childLayer.name : ''
          if (!childName) continue
          await walk([...segments, name], childName, cs)
        }
      } catch { /* skip */ }
    }
    // Resolve the root cell's layer sig from the parent's children.
    try {
      const historyAny = history as { sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>; currentLayerAt?: (s: string) => Promise<unknown> } | undefined
      if (historyAny?.sign && historyAny?.currentLayerAt) {
        const parentSig = await historyAny.sign({ explorerSegments: () => parentSegments })
        const parentLayer = await historyAny.currentLayerAt(parentSig) as { children?: readonly unknown[] } | null
        const childSigs = (parentLayer?.children ?? []) as readonly unknown[]
        let cellLayerSig: string | undefined
        for (const cs of childSigs) {
          if (typeof cs !== 'string') continue
          const cl = await history?.getLayerBySig?.(cs)
          if (cl?.name === cellName) { cellLayerSig = cs; break }
        }
        await walk(parentSegments, cellName, cellLayerSig)
      } else {
        await walk(parentSegments, cellName)
      }
    } catch { /* missing cell */ }
    if (cleared > 0) {
      EffectBus.emit('paired-channel:imported', { cellName, cleared })
    }
    return { cleared }
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
   * Self-attestation: each peer auto-approves its OWN share-requests
   * by publishing a matching `share` event signed by the same key.
   * The state machine accepts requester-signed shares (in addition to
   * host-signed ones), so every peer can promote its own offers to
   * "approved" with no host bottleneck.
   *
   * Trust boundary: the channelId (sha256 of lineage + secret) IS the
   * access filter. Anyone in the channel proved knowledge of the
   * shared password, so the bag itself is the gate. Host approval
   * remains available for future "I want to share but ask permission
   * first" flows; it isn't required for symmetric sync.
   */
  async #maybeAutoApprove(channelId: string, share: ShareState): Promise<void> {
    const myPubkey = await this.#myPubkey()
    if (!myPubkey) return
    if (share.requesterPubkey !== myPubkey) return // someone else's request
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
   * report which sigs the machine has buffered. Returns the same shape
   * the legacy materialise call used so existing callers in `expose.drone`
   * continue to compile — but no folder mints, no 0000 writes, no
   * filesystem side effects.
   *
   * PENDING re-wire: under the layer-primitive doctrine the destination
   * write path is `LayerCommitter.update(segments, { properties, children })`
   * per layer node. That needs the committer to accept a layer tree
   * (or this function to walk children → properties resource → commitSlotSet
   * pairs depth-first). Until that path exists, the receive side falls
   * through to whatever events the publish path emits; nothing materialises
   * locally.
   *
   * Compile-time stub — preserves the shape, drops the legacy folder writes.
   */
  async materialiseFromSig(
    channelId: string,
    sig: string,
    _parentDir: FileSystemDirectoryHandle,
    _opts: {
      maxDepth?: number
      parentSegments?: readonly string[]
      approvalId?: string | null
      transient?: boolean
    } = {},
  ): Promise<{ written: number; missing: string[]; skipped: number }> {
    const machine = this.#channels.get(channelId)?.machine
    if (!machine) return { written: 0, missing: [sig], skipped: 0 }

    const visited = new Set<string>()
    const missing: string[] = []
    let skipped = 0

    const walk = (s: string): void => {
      if (visited.has(s)) return
      visited.add(s)
      const content = machine.layer(s)
      if (!content) { missing.push(s); return }
      skipped++ // every buffered node is "skipped" — no write path yet
      for (const child of content.children) walk(child.sig)
    }

    this.#materialiseInProgress++
    try { walk(sig) }
    finally { this.#materialiseInProgress-- }

    return { written: 0, missing, skipped }
  }

  // ── internal: event routing & rules ───────────────────────────────

  #onChannelEvent(channelId: string, event: ChannelEvent): void {
    const joined = this.#channels.get(channelId)
    if (!joined) return

    // Freshness gate. Reject events older than (boot - 60s). Without
    // this, the relay's replay-on-subscribe seeds every brand-new
    // session with months of past share-approved verbs, each one
    // auto-materialising as an ephemeral preview tile. With it, the
    // state machine only ever sees fresh peer publishes — exactly the
    // verbs the user is producing right now in their other tab.
    //
    // Note: this gate is tighter than the swarm freshness gate (90s)
    // because paired-channel state transitions are decisions the user
    // sees on canvas (toasts, facades). A 60s window is more than
    // enough for live peers (heartbeat-equivalent is ≤30s) and keeps
    // boot-time clutter to zero.
    const minAcceptableSec = this.#sessionBootSec - PairedChannelDrone.CHANNEL_EVENT_GRACE_SEC
    if (event.createdAt && event.createdAt < minAcceptableSec) {
      // Silent drop — verbose log would spam on every join. Uncomment
      // if debugging unexpected facade absences:
      // console.log('[paired-channel] dropping stale event', { age: this.#sessionBootSec - event.createdAt, verb: event.type })
      return
    }

    const transitions = joined.machine.apply(event)
    console.log('[sync] event in', {
      channel: channelId.slice(0, 12),
      verb: event.type,
      from: String(event.pubkey ?? '').slice(0, 8),
      transitions: transitions.map(t => t.kind),
    })
    for (const t of transitions) this.#onTransition(channelId, t)
  }

  #onTransition(channelId: string, t: Transition): void {
    console.log('[sync] transition', { channel: channelId.slice(0, 12), kind: t.kind })
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

// Singleton guard: if an older version of this bee was already
// shipped (multiple `__bees__/<sig>.js` files all register the same
// ioc key), the FIRST instance wins. The constructor side-effects
// (listeners, boot-poll) only run once. Without this every legacy
// bee's heartbeat fires in parallel and they subscribe to different
// channels — which is exactly what was producing the "two channelIds
// in one browser" bug.
const IOC_KEY = '@diamondcoreprocessor.com/PairedChannelDrone'
if (!(window as any).ioc.get(IOC_KEY)) {
  const _pairedChannelDrone = new PairedChannelDrone()
  window.ioc.register(IOC_KEY, _pairedChannelDrone)
}

// Suppress unused warnings for verbs that callers will use elsewhere.
const _verbs: ChannelVerb[] = ['announce', 'join', 'admit', 'revoke', 'share-request', 'share', 'share-revoked', 'pulled', 'layer', 'node', 'audit-needed', 'approve', 'reject', 'auditors']
void _verbs
void ({} as ShareState)
