// diamondcoreprocessor.com/sharing/expose.drone.ts
//
// UI surface for paired-channel sharing.
//
//   • Registers the `expose` icon on every tile via IconProviderRegistry.
//     Clicking it on a local tile fires a share-request for that tile's
//     branch into the first joined paired-channel.
//
//   • Listens for `paired-channel:share-approved` effects. When a share
//     becomes visible to channel members, surfaces a toast with a
//     "sync" action button. Clicking the action materialises the
//     shared content into the receiver's current location and emits
//     a `pulled` event for the host's cap counter.
//
// v0 simplifications (called out in paired-channel.machine + drone):
//
//   - Inline body payload (the requesting tile's 0000 properties) —
//     a single tile, no subtree walk, no separate `layer` events.
//   - Auto-host-approval (handled in paired-channel.drone) — toast
//     surfaces approval as it happens.
//   - Materialisation = create folder + write 0000. No layer commit
//     ceremony yet; that lands when the receive path moves to real
//     subtree sharing.

import { Drone, EffectBus } from '@hypercomb/core'
import { readCellProperties, writeCellProperties } from '../editor/tile-properties.js'
import { PAIRED_CHANNEL_EFFECTS } from './paired-channel.drone.js'
import type { PairedChannelDrone } from './paired-channel.drone.js'
import {
  computeLayerSig,
  type PairedLayerContent,
  type ShareState,
} from './paired-channel.machine.js'

const EXPOSE_ICON_NAME = 'expose'
const SYNC_ICON_NAME = 'sync'
const MERGE_ICON_NAME = 'merge'
const TILE_ACTION_EXPOSE = 'expose'
const TILE_ACTION_SYNC = 'sync'
const TILE_ACTION_MERGE = 'merge'
const SHARE_APPROVE_EFFECT = 'paired-channel:approve-share'
const SHARE_REJECT_EFFECT = 'paired-channel:reject-share'
const EGG_UNLOCK_EFFECT = 'egg:unlock-selected'

/**
 * Keys written into 0000 when a share is materialised as a facade.
 * The sync icon click handler reads these to resolve which channel +
 * which sig to fill. Surface stays minimal: facade flag + the three
 * fields we need to recurse later.
 */
interface FacadeMetadata {
  facade: true
  channelId: string
  branchSig: string
  approvalId?: string | null
}

// Inline SVG — upward arrow exiting a tray ("share / upload"). Uses
// the same conventions as the rest of the icon catalog: explicit
// xmlns, white stroke (Pixi's icon-button context doesn't resolve
// currentColor), 24×24 viewBox, round caps/joins.
const EXPOSE_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="M8 8l4-4 4 4"/><path d="M5 14v6h14v-6"/></svg>`

// Mirror of EXPOSE_ICON_SVG — downward arrow into a tray. Conceptually
// "pull / sync down." No visibility filter at the catalog level (the
// IconProvider shape doesn't expose visibleWhen); click handler is a
// silent no-op on non-facade tiles.
const SYNC_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-10"/><path d="M16 16l-4 4-4-4"/><path d="M5 4v6h14V4"/></svg>`

// Merge — two arrows converging into a single trunk. Conveys "pull
// the offered subtree and integrate it with my existing tile of the
// same name" (rather than replacing it). Silent no-op on a tile that
// has no incoming offer to merge.
const MERGE_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l4 6"/><path d="M19 4l-4 6"/><path d="M12 10v10"/><path d="M8 16l4 4 4-4"/></svg>`

interface IconProviderRegistry {
  add(p: { name: string; owner: string; svgMarkup: string; profile?: string; hoverTint?: number; labelKey?: string; descriptionKey?: string }): void
  remove(name: string): void
}

interface TileActionPayload {
  action: string
  label: string
  q: number
  r: number
  index: number
}

interface ApproveSharePayload {
  channelId: string
  requestId: string
}

interface LineageLike {
  explorerSegments: () => readonly string[]
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null>
}

export class ExposeDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Tile-level UI for paired-channel sharing. Adds an expose icon to local tiles; surfaces sync prompts when another participant exposes content.'

  public override grammar = [{ example: 'expose tile' }]

  protected override listens: string[] = [
    'tile:action',
    PAIRED_CHANNEL_EFFECTS.shareRequestReceived,
    PAIRED_CHANNEL_EFFECTS.shareApproved,
    PAIRED_CHANNEL_EFFECTS.layerReceived,
    EGG_UNLOCK_EFFECT,
    SHARE_APPROVE_EFFECT,
    SHARE_REJECT_EFFECT,
    'paired-channel:adopt-request',
  ]

  protected override emits: string[] = ['toast:show']

  // ── lifecycle ─────────────────────────────────────────────────────

  constructor() {
    super()
    this.#registerIcon()

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (!payload?.action) return
      if (payload.action === TILE_ACTION_EXPOSE) { void this.#onExpose(payload.label); return }
      if (payload.action === TILE_ACTION_SYNC) { void this.#onUnlockTile(payload.label, 'create'); return }
      if (payload.action === TILE_ACTION_MERGE) { void this.#onUnlockTile(payload.label, 'merge'); return }
    })

    // EggMenuPack's "unlock" button fires this. Iterate the supplied
    // labels; non-facade tiles are no-ops inside #onUnlockTile.
    this.onEffect<{ labels: readonly string[] }>(EGG_UNLOCK_EFFECT, (payload) => {
      const labels = Array.isArray(payload?.labels) ? payload.labels : []
      for (const label of labels) {
        if (typeof label === 'string' && label) void this.#onUnlockTile(label)
      }
    })

    // No share-request approval prompt — every peer auto-attests its
    // own shares now, so receivers don't need to "Approve". The legacy
    // #offerApproval toast was firing on every incoming share-request
    // and asking the user to confirm what's already being delivered.

    this.onEffect<{ channelId: string; share: ShareState }>(
      PAIRED_CHANNEL_EFFECTS.shareApproved,
      (payload) => {
        if (!payload?.share) return
        // Auto-materialise the facade. The receiver gets a tile (with
        // empty children) at the current location immediately; clicking
        // the sync icon on it later fills the full subtree.
        void this.#materialiseFacade(payload.channelId, payload.share)
      },
    )

    this.onEffect<ApproveSharePayload>(SHARE_APPROVE_EFFECT, (payload) => {
      if (!payload?.requestId) return
      void this.#approveShare(payload.channelId, payload.requestId)
    })

    this.onEffect<ApproveSharePayload>(SHARE_REJECT_EFFECT, (_payload) => {
      // No-op for v0 — rejection is implicit (no `share` event ever
      // published, request ages out via NIP-40 expiration). Kept here
      // so the toast's reject button has a destination and we can
      // wire an explicit `reject` verb later if we want auditability.
    })

    // Adopt: receiver clicked import on an ephemeral preview tile.
    // Look up the share by branchName, run materialiseFromSig with
    // full depth so the entire subtree lands in OPFS as real layers.
    this.onEffect<{ branchName?: string }>('paired-channel:adopt-request', (payload) => {
      console.log('[sync] expose: adopt-request received', payload)
      const name = payload?.branchName
      if (typeof name !== 'string' || !name) return
      void this.#adoptEphemeral(name)
    })

    // Import: receiver promotes a transient sync tile to a permanent
    // layer. Clears `transient: true` recursively so the boot sweep
    // doesn't remove it next session.
    this.onEffect<{ branchName?: string }>('paired-channel:import-request', async (payload) => {
      const name = payload?.branchName
      if (typeof name !== 'string' || !name) return
      const drone = this.#pairedChannelDrone()
      if (!drone?.importTransientTree) {
        this.#toast('warning', 'Import failed', 'PairedChannelDrone unavailable.')
        return
      }
      const result = await drone.importTransientTree(name)
      if (result.cleared === 0) {
        this.#toast('tip', 'Nothing to import', `"${name}" is already permanent.`)
      } else {
        this.#toast('success', 'Imported',
          `"${name}" (${result.cleared} cell${result.cleared === 1 ? '' : 's'}) is now permanent.`)
      }
    })
  }

  async #adoptEphemeral(branchName: string): Promise<void> {
    console.log('[sync] adopt: start', { branchName })
    const drone = this.#pairedChannelDrone()
    if (!drone) {
      console.warn('[sync] adopt: PairedChannelDrone unavailable')
      this.#toast('warning', 'Adopt failed', 'PairedChannelDrone unavailable.')
      return
    }
    const lineage = window.ioc.get('@hypercomb.social/Lineage') as LineageLike | undefined
    const dir = await lineage?.explorerDir?.()
    if (!dir) {
      console.warn('[sync] adopt: no explorer dir')
      this.#toast('warning', 'Adopt failed', 'No explorer directory.')
      return
    }
    const segments = lineage?.explorerSegments?.() ?? []
    const here = '/' + segments.join('/')

    // Find the ephemeral entry for this branchName at the current bag.
    const candidates = (drone as any).ephemeralSharesAt?.(here) ?? []
    console.log('[sync] adopt: ephemeral candidates at', here, ':', candidates.map((c: any) => c.branchName))
    const match = candidates.find((e: { branchName: string }) => e.branchName === branchName)
    if (!match) {
      console.warn('[sync] adopt: no ephemeral share found for', branchName)
      this.#toast('warning', 'Adopt failed', `No ephemeral share found for "${branchName}".`)
      return
    }
    if (!drone.layerOf?.(match.channelId, match.branchSig)) {
      console.warn('[sync] adopt: root layer not buffered', match.branchSig)
      this.#toast('warning', 'Adopt failed',
        `Root layer ${match.branchSig.slice(0, 8)} hasn't arrived yet — try again in a moment.`)
      return
    }
    console.log('[sync] adopt: materialising', { channelId: match.channelId.slice(0, 12), branchSig: match.branchSig.slice(0, 12) })

    let result: { written: number; missing: string[]; skipped: number }
    try {
      result = await drone.materialiseFromSig(match.channelId, match.branchSig, dir, {
        maxDepth: Number.POSITIVE_INFINITY,
        parentSegments: segments,
        approvalId: match.approvalId,
      })
    } catch (err) {
      this.#toast('warning', 'Adopt failed', String((err as Error)?.message ?? err))
      return
    }

    // Drop the ephemeral entry — the cells now live in OPFS.
    drone.clearEphemeralShare?.(branchName)
    EffectBus.emit('paired-channel:share-installed', { branchName, location: here })

    if (result.missing.length > 0) {
      this.#toast('tip', 'Adopted (partial)',
        `Wrote ${result.written} layer(s). ${result.missing.length} sig(s) still missing.`)
    } else {
      this.#toast('success', 'Adopted',
        `"${branchName}" + ${Math.max(0, result.written - 1)} descendant(s) are now yours.`)
    }

    if (match.approvalId) void drone.markPulled?.(match.channelId, match.approvalId)
  }

  // No per-pulse work; all behavior is event-driven.
  public override heartbeat = async (): Promise<void> => { /* noop */ }

  // ── expose path ────────────────────────────────────────────────────

  #registerIcon(): void {
    const registry = window.ioc.get('@hypercomb.social/IconProviderRegistry') as IconProviderRegistry | undefined
    // Both go on `public-own` (tiles the user owns in public mode).
    // EggMenuPack also surfaces unlock for multi-select, but the
    // per-tile sync icon is the discoverable button users will reach
    // for first. Click handlers are inert on non-facade tiles.
    registry?.add({
      name: EXPOSE_ICON_NAME,
      owner: '@diamondcoreprocessor.com/ExposeDrone',
      svgMarkup: EXPOSE_ICON_SVG,
      profile: 'public-own',
      hoverTint: 0xa6e3a1,
      labelKey: 'action.expose',
      descriptionKey: 'action.expose.description',
    })
    registry?.add({
      name: SYNC_ICON_NAME,
      owner: '@diamondcoreprocessor.com/ExposeDrone',
      svgMarkup: SYNC_ICON_SVG,
      profile: 'public-own',
      hoverTint: 0x80c8ff,
      labelKey: 'action.sync',
      descriptionKey: 'action.sync.description',
    })
    registry?.add({
      name: MERGE_ICON_NAME,
      owner: '@diamondcoreprocessor.com/ExposeDrone',
      svgMarkup: MERGE_ICON_SVG,
      profile: 'public-own',
      hoverTint: 0xc8a8ff,
      labelKey: 'action.merge',
      descriptionKey: 'action.merge.description',
    })
  }

  async #onExpose(tileLabel: string): Promise<void> {
    const channel = this.#firstJoinedChannel()
    if (!channel) {
      console.warn('[sync] expose blocked: no joined channel for', tileLabel)
      this.#toast('warning', 'No paired channel',
        'Set hypercomb.paired-channel.location and hypercomb.paired-channel.secret in localStorage, then reload.')
      return
    }
    console.log('[sync] expose start', { tile: tileLabel, channel: channel.slice(0, 12) })

    const lineage = window.ioc.get('@hypercomb.social/Lineage') as LineageLike | undefined
    const dir = await lineage?.explorerDir?.()
    if (!dir) {
      this.#toast('warning', 'Expose failed', 'No explorer directory for the current lineage.')
      return
    }

    let cellDir: FileSystemDirectoryHandle
    try {
      cellDir = await dir.getDirectoryHandle(tileLabel, { create: false })
    } catch {
      this.#toast('warning', 'Expose failed', `Tile "${tileLabel}" was not found in the current location.`)
      return
    }

    const drone = this.#pairedChannelDrone()
    if (!drone) {
      this.#toast('warning', 'Expose failed', 'PairedChannelDrone is not available.')
      return
    }

    // Walk the subtree depth-first, computing each cell's canonical
    // layer sig and collecting the (sig, content) pairs to publish.
    let layers: { sig: string; content: PairedLayerContent }[]
    try {
      layers = await buildSubtreeLayers(cellDir, tileLabel)
    } catch (err) {
      this.#toast('warning', 'Expose failed', `Subtree walk threw: ${(err as Error)?.message ?? err}`)
      return
    }

    if (layers.length === 0) {
      this.#toast('warning', 'Expose failed', 'No layers produced from the subtree.')
      return
    }

    // Publish every layer event before the share-request so receivers
    // have the bytes buffered by the time they see the offer.
    let pushed = 0
    for (const { sig, content } of layers) {
      const ok = await drone.publishLayer(channel, sig, content)
      if (ok) pushed++
    }
    console.log('[sync] published layers', { tile: tileLabel, pushed, total: layers.length })
    if (pushed === 0) {
      this.#toast('warning', 'Expose failed',
        'No layer events were published — mesh signer or relay unavailable.')
      return
    }

    // Root sig is the first layer in our walk (we started from the
    // chosen tile and walked down). Build the preview from its children.
    const root = layers[0]
    const byteEstimate = layers.reduce(
      (n, l) => n + approxJsonByteLength(l.content),
      0,
    )
    const preview = {
      name: root.content.name,
      children: root.content.children.map(c => ({ name: c.name })),
    }

    const ok = await drone.requestShare(channel, {
      branchSig: root.sig,
      branchName: root.content.name,
      tileCount: layers.length,
      byteEstimate,
      preview,
      body: null, // bytes flow via separate `layer` events now
    })
    console.log('[sync] requestShare', { tile: tileLabel, branchSig: root.sig.slice(0, 12), ok })

    if (ok) {
      this.#toast('info', 'Exposed',
        `Pushed ${layers.length} layer${layers.length === 1 ? '' : 's'} for "${tileLabel}" and requested share. Waiting for host approval.`)
    } else {
      this.#toast('warning', 'Expose failed',
        `Couldn't publish share-request — mesh signer or relay unavailable.`)
    }
  }

  // ── host approval path ─────────────────────────────────────────────

  #offerApproval(channelId: string, share: ShareState): void {
    // Surfaces a host-approval prompt as a sticky toast with two action
    // buttons (Approve / Reject). Toast.drone supports a single
    // actionLabel/actionEffect pair, so we open one toast for Approve;
    // reject is "do nothing, let the request expire" which costs the
    // host nothing.
    const summary = share.byteEstimate
      ? `${share.tileCount ?? 1} tile · ~${formatBytes(share.byteEstimate)}`
      : `${share.tileCount ?? 1} tile`
    EffectBus.emit('toast:show', {
      type: 'tip',
      title: `Share request: ${share.branchName}`,
      message: `${summary}. Click Approve to host this share for the channel.`,
      duration: 0, // sticky
      actionLabel: 'Approve',
      actionEffect: SHARE_APPROVE_EFFECT,
      actionPayload: { channelId, requestId: share.requestId } satisfies ApproveSharePayload,
    })
  }

  async #approveShare(channelId: string, requestId: string): Promise<void> {
    const drone = this.#pairedChannelDrone()
    if (!drone) {
      this.#toast('warning', 'Approval failed', 'PairedChannelDrone is not available.')
      return
    }
    const ok = await drone.approveShare(channelId, requestId, null)
    if (!ok) {
      this.#toast('warning', 'Approval failed',
        `Couldn't publish share event — either the request already expired, your client isn't the host, or the relay is unavailable.`)
    }
    // No success toast — the share-approved effect that comes back from
    // the relay will trigger the sync toast; that's the visible signal.
  }

  // ── receive path ───────────────────────────────────────────────────

  /**
   * Auto-create a facade tile for an approved share at the receiver's
   * current location. The folder + 0000 land immediately so the user
   * sees a visible tile (an "egg") with empty children. Selecting the
   * tile and clicking "Unlock" in the vertical menu fires the
   * `egg:unlock-selected` effect, which routes to #onUnlockTile and
   * fills in the full subtree from the buffered layer events.
   *
   * Skips if a tile with the same name already exists at this location
   * (the source side: host's auto-approval echoes back to itself, but
   * we don't need to overwrite the source tile).
   *
   * The facade write goes through writeCellProperties, so FacadeNurse +
   * IndexNurse pick up the change automatically.
   */
  async #materialiseFacade(channelId: string, share: ShareState): Promise<void> {
    const lineage = window.ioc.get('@hypercomb.social/Lineage') as LineageLike | undefined
    const dir = await lineage?.explorerDir?.()
    if (!dir) {
      console.warn('[sync] share: no explorer dir', { tile: share.branchName })
      return
    }
    const segments = lineage?.explorerSegments?.() ?? []

    const targetName = share.branchName
    if (!targetName) return

    // Source-side echo: the sender's own approval comes back through
    // the channel. Skip if the tile already exists locally — we own it,
    // it doesn't need to appear as a preview of itself.
    try {
      await dir.getDirectoryHandle(targetName, { create: false })
      return
    } catch { /* not present, proceed as ephemeral */ }

    // EPHEMERAL PREVIEW: don't write to OPFS. Record the share in the
    // drone's #ephemeralShares; show-cell renders these as dashed/distinct
    // preview tiles by merging them into its tile list. The user clicks
    // the per-tile adopt icon to commit the subtree to OPFS, which fires
    // 'paired-channel:adopt-request' → #adoptEphemeral → materialiseFromSig.
    // Until adopted: the tile lives only in memory (machine.state.layers
    // + this share entry). Close the tab and it's gone.
    const drone = this.#pairedChannelDrone()
    if (!drone) {
      console.warn('[sync] share: PairedChannelDrone unavailable')
      return
    }
    if (!drone.layerOf(channelId, share.branchSig)) {
      console.warn('[sync] share: root layer not buffered yet', share.branchSig)
      return
    }
    const location = '/' + segments.join('/')
    drone.recordEphemeralShare({
      channelId,
      location,
      branchName: targetName,
      branchSig: share.branchSig,
      approvalId: share.approvalId,
    })
    console.log('[sync] share: ephemeral preview', { tile: targetName, location, branchSig: share.branchSig.slice(0, 12) })
    if (share.approvalId) void drone.markPulled(channelId, share.approvalId)
    // Signal renderers to pick up the new ephemeral tile.
    EffectBus.emit('paired-channel:preview-changed', { channelId, location, branchName: targetName })
  }

  /**
   * Unlock handler for one tile. Reads the tile's facade metadata
   * from 0000, calls drone.materialiseFromSig to recursively fill the
   * subtree, then drops `facade: true` from 0000 so the tile becomes
   * a normal cell.
   *
   * No-op if the tile isn't a facade. EggMenuPack surfaces the
   * unlock button for any selection, so plain tiles can also have
   * the unlock invoked — they fall through silently here rather
   * than misbehaving.
   */
  async #onUnlockTile(tileLabel: string, _mode: 'create' | 'merge' = 'create'): Promise<void> {
    const lineage = window.ioc.get('@hypercomb.social/Lineage') as LineageLike | undefined
    const dir = await lineage?.explorerDir?.()
    if (!dir) {
      this.#toast('warning', 'Sync failed', 'No explorer directory.')
      return
    }

    let cellDir: FileSystemDirectoryHandle
    try {
      cellDir = await dir.getDirectoryHandle(tileLabel, { create: false })
    } catch {
      this.#toast('warning', 'Sync failed', `Tile "${tileLabel}" not found.`)
      return
    }

    const props = await readCellProperties(cellDir)
    if (props['facade'] !== true) {
      // Plain tile, not a facade — nothing to fill in.
      return
    }
    const channelId = typeof props['channelId'] === 'string' ? props['channelId'] : ''
    const branchSig = typeof props['branchSig'] === 'string' ? props['branchSig'] : ''
    if (!channelId || !branchSig) {
      this.#toast('warning', 'Sync failed', 'Facade metadata is incomplete.')
      return
    }

    const drone = this.#pairedChannelDrone()
    if (!drone) {
      this.#toast('warning', 'Sync failed', 'PairedChannelDrone is not available.')
      return
    }

    if (!drone.layerOf(channelId, branchSig)) {
      this.#toast('warning', 'Sync failed',
        `Root layer ${branchSig.slice(0, 8)} hasn't arrived yet. Wait a moment and try again.`)
      return
    }

    // Strict preserve: existing cells stay untouched, only genuinely-
    // new descendants get added. The facade tile itself already
    // exists — its 0000 keeps whatever it already has — we just
    // recurse to fill new descendants beneath it. Always-on
    // preserve also means there is no "overwrite" mode to choose.
    const parentSegments = lineage?.explorerSegments?.() ?? []
    let result: { written: number; missing: string[]; skipped: number }
    try {
      result = await drone.materialiseFromSig(channelId, branchSig, dir, { parentSegments })
    } catch (err) {
      this.#toast('warning', 'Sync failed', String((err as Error)?.message ?? err))
      return
    }

    // Drop the facade flag so the tile no longer surfaces the adopt
    // icon. Done as an explicit step because strict-preserve never
    // touches existing cells' 0000s.
    try {
      await writeCellProperties(cellDir, { facade: false })
    } catch (err) {
      console.warn('[expose] sync: failed to drop facade flag', err)
    }

    if (result.missing.length > 0) {
      this.#toast('tip', 'Synced (partial)',
        `Added ${result.written} layer(s). ${result.missing.length} sig(s) still missing — they may arrive later.`)
    } else if (result.written === 0) {
      this.#toast('info', 'Nothing to sync',
        `"${tileLabel}" and its descendants are already in your hive.`)
    } else {
      this.#toast('success', 'Synced',
        `Added ${result.written} new descendant${result.written === 1 ? '' : 's'} under "${tileLabel}".`)
    }

    const approvalId = typeof props['approvalId'] === 'string' ? props['approvalId'] : ''
    if (approvalId) {
      void drone.markPulled(channelId, approvalId)
    }
  }

  // ── helpers ────────────────────────────────────────────────────────

  #pairedChannelDrone(): PairedChannelDrone | null {
    const d = window.ioc.get('@diamondcoreprocessor.com/PairedChannelDrone') as PairedChannelDrone | undefined
    return d ?? null
  }

  #firstJoinedChannel(): string | null {
    const drone = this.#pairedChannelDrone()
    if (!drone) return null
    const ids = drone.joinedChannels()
    return ids[0] ?? null
  }

  #toast(type: 'info' | 'success' | 'tip' | 'warning', title: string, message: string): void {
    EffectBus.emit('toast:show', { type, title, message })
  }
}

// ── pure utilities ──────────────────────────────────────────────────

async function listChildNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = []
  for await (const [name, handle] of (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind !== 'directory') continue
    if (name.startsWith('__') && name.endsWith('__')) continue
    out.push(name)
  }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

/**
 * Walk a cell directory recursively, computing the canonical
 * (sig, content) pair for every cell in the subtree. Returns the
 * root at `result[0]` followed by descendants in post-order.
 *
 * Receivers don't depend on the order — they materialise by sig
 * lookup into the buffer, which fills as events arrive — but emitting
 * the root first means a relay watcher can immediately see "share X
 * named foo" as the first layer event, which makes diagnostics
 * easier.
 */
/**
 * 0000 keys that are local render-cache decorations, NOT content
 * identity. Stripped from `properties` before computing layer sigs
 * (so two peers with the same actual content but different cache
 * states still hash to the same sig) and stripped again on the
 * receiver before writing to 0000.
 *
 *   `children`     — sighash pointer into a children-list cache file
 *                    (the canonical child list lives in the layer's
 *                    `children` array, not here).
 *   `facade*`      — paired-channel sync placeholder markers; the
 *                    receiver writes its own based on its local state.
 */
const SYNC_DECORATION_KEYS = [
  // Sync-protocol decorations (already excluded)
  'children', 'facade', 'branchSig', 'channelId', 'approvalId',
  // Render / layout state — must not be part of the canonical layer sig.
  // These vary per browser (viewport per-tab) or per-render-pass (pinned
  // index after zoom-to-fit) and would cause the layer sig to drift on
  // every pan or zoom. Per-cell layout belongs in the optimization
  // (decoration) layer alongside Q&A and comms, not in canonical content.
  'index', 'viewport', 'pan', 'zoom', 'meshOffset',
  // Stale transient marker from the old in-OPFS-with-marker model — kept
  // out of sig so it doesn't survive into the layer identity even if it
  // accidentally appears in a cell's 0000.
  'transient',
] as const

function stripDecorations(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props }
  for (const k of SYNC_DECORATION_KEYS) delete out[k]
  return out
}

async function buildSubtreeLayers(
  cellDir: FileSystemDirectoryHandle,
  cellName: string,
): Promise<{ sig: string; content: PairedLayerContent }[]> {
  const descendants: { sig: string; content: PairedLayerContent }[] = []

  const visit = async (
    dir: FileSystemDirectoryHandle,
    name: string,
  ): Promise<{ sig: string; content: PairedLayerContent }> => {
    const childNames = await listChildNames(dir)
    const children: { name: string; sig: string }[] = []
    for (const childName of childNames) {
      let childDir: FileSystemDirectoryHandle
      try { childDir = await dir.getDirectoryHandle(childName, { create: false }) }
      catch (err) { console.warn('[expose] subtree: skipping', childName, err); continue }
      const child = await visit(childDir, childName)
      children.push({ name: childName, sig: child.sig })
      descendants.push(child)
    }
    // Strip decorations: layer sigs must depend on content alone, not
    // on whether the sender's local cache happened to be populated.
    const rawProperties = await readCellProperties(dir)
    const properties = stripDecorations(rawProperties)
    const content: PairedLayerContent = { name, properties, children }
    const sig = await computeLayerSig(content)
    return { sig, content }
  }

  const root = await visit(cellDir, cellName)
  return [root, ...descendants]
}

function approxJsonByteLength(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength }
  catch { return 0 }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

// ── registration ─────────────────────────────────────────────────────

const _exposeDrone = new ExposeDrone()
window.ioc.register('@diamondcoreprocessor.com/ExposeDrone', _exposeDrone)
