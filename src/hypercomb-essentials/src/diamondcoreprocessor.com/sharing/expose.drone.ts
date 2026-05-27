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
import { readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'
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
    // Layer-primitive: sub-layer locations have no on-disk dir, so the
    // adopt path no longer needs (or has) one. We address everything by
    // segments; the LayerCommitter cascade folds the adopted subtree
    // into the parent layer's `children` slot.
    const lineage = window.ioc.get('@hypercomb.social/Lineage') as LineageLike | undefined
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
      result = await drone.materialiseFromSig(match.channelId, match.branchSig, null as unknown as FileSystemDirectoryHandle, {
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
    // Intentionally registers no icons. The swarm subsumes the
    // paired-channel expose/sync/merge flow:
    //
    //   - For PEER (public-external) tiles, the canonical icons are
    //     `adopt` and `block` registered by tile-actions.drone with
    //     profile 'public-external'. Both wire to my SwarmAdoptDrone
    //     and the show-cell hidden-tiles filter respectively.
    //
    //   - For OWNED (public-own) tiles, the previous expose/sync/merge
    //     trio was paired-channel-specific and confusing on the canvas
    //     (clicking sync on a tile you already own bails silently —
    //     "nothing happens"). The handlers (#onExpose etc.) remain in
    //     this drone so any code path that still emits
    //     `tile:action` with action='expose' programmatically works.
    void this.#firstJoinedChannel  // keep TS happy when icon usage is removed
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
    const segments = lineage?.explorerSegments?.() ?? []

    const drone = this.#pairedChannelDrone()
    if (!drone) {
      this.#toast('warning', 'Expose failed', 'PairedChannelDrone is not available.')
      return
    }

    // Walk the tile's layer tree (not OPFS dirs) depth-first, computing
    // each layer's PairedLayerContent sig and collecting (sig, content)
    // pairs to publish. The tile may live entirely in the layer graph
    // with no on-disk dir — that's the new normal.
    let layers: { sig: string; content: PairedLayerContent }[]
    try {
      layers = await buildSubtreeLayersFromLayerTree(segments, tileLabel)
    } catch (err) {
      this.#toast('warning', 'Expose failed',
        `Couldn't read layer tree for "${tileLabel}": ${(err as Error)?.message ?? err}`)
      return
    }

    // Verbose summary so a cross-browser test can see exactly what
    // the sender is shipping. Logs every node + child count; if this
    // says `total: 1` for a tile that has children on disk, the
    // walker missed them and we have a regression to fix.
    console.log('[sync] expose subtree summary', {
      tile: tileLabel,
      total: layers.length,
      nodes: layers.map(l => ({
        name: l.content.name,
        sig: l.sig.slice(0, 12),
        childCount: l.content.children.length,
        propKeys: Object.keys(l.content.properties),
      })),
    })

    // Surface the walk result as a tip toast too — saves having to
    // open devtools to confirm "did expose actually find the subtree?"
    // when troubleshooting a cross-browser session. Lists at most the
    // first few names so the toast stays readable on small screens.
    const previewNames = layers.slice(0, 6).map(l => l.content.name).join(', ')
    const more = layers.length > 6 ? `, +${layers.length - 6} more` : ''
    this.#toast('tip', 'Expose: walked subtree',
      `${tileLabel}: ${layers.length} layer${layers.length === 1 ? '' : 's'} (${previewNames}${more})`)

    if (layers.length === 0) {
      this.#toast('warning', 'Expose failed', 'No layers produced from the subtree.')
      return
    }

    // Publish every layer event before the share-request so receivers
    // have the bytes buffered by the time they see the offer.
    let pushed = 0
    const publishFailures: string[] = []
    for (const { sig, content } of layers) {
      const ok = await drone.publishLayer(channel, sig, content)
      if (ok) pushed++
      else publishFailures.push(content.name)
    }
    console.log('[sync] published layers', { tile: tileLabel, pushed, total: layers.length, failures: publishFailures })
    // Surface the publish result so a cross-browser test can see
    // whether ALL descendants made it onto the wire or only the root.
    // Mirrors the walker summary toast above — same pattern lets the
    // user pinpoint which hop is the broken one without devtools.
    if (pushed < layers.length) {
      this.#toast('warning', 'Expose: partial publish',
        `Published ${pushed}/${layers.length} layers. ${publishFailures.length} failed${publishFailures.length > 0 ? `: ${publishFailures.slice(0, 3).join(', ')}${publishFailures.length > 3 ? '…' : ''}` : ''}.`)
    } else {
      this.#toast('tip', 'Expose: all layers on the wire',
        `Published ${pushed}/${layers.length} layers.`)
    }
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

    if (!ok) {
      // Success path is silent — the user just clicked expose and the
      // tile change is visible; a confirmation toast on every expose
      // turns the corner into wallpaper. Failures still surface (the
      // user needs to know if mesh/signer/relay is unreachable).
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

    // Source-side echo filter, properly done by PUBKEY (not by "tile
    // exists locally", which had to come out — it also blocked
    // legitimate peer shares for a name the receiver happened to
    // have). Every channel member subscribes to share events for the
    // channel, so my OWN share-request → auto-approve cycle echoes
    // share-approved back to me. Without this filter, every tile I've
    // ever exposed accumulates as an ephemeral preview in my own
    // view, polluting the grid with my own offers (the 19 ghost tiles
    // Jaime saw).
    //
    // We use share.requesterPubkey (the original publisher who fired
    // the share-request) — not share.approvalId's signer — because in
    // the symmetric auto-approve world every peer hosts their own
    // shares and the request and the approval both originate at me.
    const signer = window.ioc.get('@diamondcoreprocessor.com/NostrSigner') as
      { getPublicKeyHex?: () => Promise<string | null> } | undefined
    const myPubkey = signer?.getPublicKeyHex ? await signer.getPublicKeyHex() : null
    if (myPubkey && share.requesterPubkey === myPubkey) {
      console.log('[sync] share: skipping self-echo', { tile: targetName, branchSig: share.branchSig.slice(0, 12) })
      return
    }

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
    const parentSegments = lineage?.explorerSegments?.() ?? []
    const dir = await lineage?.explorerDir?.()

    // Read properties from the cell's layer (canonical). The tile may
    // exist as a layer-only entry with no OPFS dir — that's fine.
    const props = await readTilePropertiesAt(parentSegments, tileLabel)
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
    // exists — we just recurse to fill new descendants beneath it.
    // materialiseFromSig still consults the OPFS subtree for now —
    // its migration belongs to a separate cut.
    if (!dir) {
      this.#toast('warning', 'Sync failed', 'No explorer directory.')
      return
    }
    let result: { written: number; missing: string[]; skipped: number }
    try {
      result = await drone.materialiseFromSig(channelId, branchSig, dir, { parentSegments })
    } catch (err) {
      this.#toast('warning', 'Sync failed', String((err as Error)?.message ?? err))
      return
    }

    // Drop the facade flag from the layer's properties slot so the
    // tile no longer surfaces the adopt icon. Layer write, no OPFS
    // dir touched.
    try {
      await writeTilePropertiesAt(parentSegments, tileLabel, { facade: false })
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

/**
 * Property keys that are local render-cache decorations, NOT content
 * identity. Stripped from `properties` before computing layer sigs so
 * two peers with the same actual content but different cache states
 * still hash to the same sig.
 *
 *   `children`     — legacy sighash pointer (the canonical child list
 *                    lives in the layer's `children` array now).
 *   `facade*`      — paired-channel sync placeholder markers; the
 *                    receiver writes its own based on local state.
 *   `index/viewport/pan/zoom/meshOffset` — per-tab render state.
 *   `transient`    — old in-OPFS-with-marker model leftover.
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

type HistoryServiceLike = {
  sign: (l: { explorerSegments: () => readonly string[] }) => Promise<string>
  latestMarkerSigFor: (lineageSig: string, name: string) => Promise<string>
  getLayerBySig: (sig: string) => Promise<{ name: string; children?: readonly string[]; [k: string]: unknown } | null>
}

/**
 * Walk a tile's full subtree from the layer graph and produce a flat
 * list of `PairedLayerContent` records — one per node — each with a
 * stable sig computed from its canonical bytes.
 *
 * Layer-as-primitive: the sig bag IS the source of truth. Children
 * are sig pointers in `layer.children`; each child's name lives
 * INSIDE that child's layer. Properties resolve through the layer's
 * `properties` slot via {@link readTilePropertiesAt}. No OPFS
 * directory walk and no `0000` file fallback — if a tile isn't in
 * the layer graph, it doesn't exist.
 */
async function buildSubtreeLayersFromLayerTree(
  parentSegments: readonly string[],
  tileName: string,
): Promise<{ sig: string; content: PairedLayerContent }[]> {
  const iocGet = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get
  const history = iocGet?.('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined
  if (!history) throw new Error('HistoryService unavailable')

  const descendants: { sig: string; content: PairedLayerContent }[] = []
  const visited = new Set<string>() // guard against cycles in the layer graph

  const visit = async (
    segments: readonly string[],
    name: string,
  ): Promise<{ sig: string; content: PairedLayerContent } | null> => {
    // Resolve this tile's bag location, then its head layer.
    const lineageSig = await history.sign({ explorerSegments: () => [...segments, name] })
    if (!lineageSig) return null
    if (visited.has(lineageSig)) return null
    visited.add(lineageSig)

    const layerSig = await history.latestMarkerSigFor(lineageSig, name)
    const layer = layerSig ? await history.getLayerBySig(layerSig) : null

    const childLayerSigs: readonly string[] = Array.isArray(layer?.children)
      ? (layer!.children as readonly string[])
      : []
    const children: { name: string; sig: string }[] = []
    for (const childLayerSig of childLayerSigs) {
      const childLayer = await history.getLayerBySig(childLayerSig)
      const childName = typeof childLayer?.name === 'string' ? childLayer.name : ''
      if (!childName) continue
      const childResult = await visit([...segments, name], childName)
      if (!childResult) continue
      children.push({ name: childName, sig: childResult.sig })
      descendants.push(childResult)
    }

    // Properties: layer slot only. The renderer reads from the same
    // primitive, so anything not on the layer doesn't visibly exist —
    // we don't ship it.
    let rawProperties: Record<string, unknown> = {}
    try { rawProperties = await readTilePropertiesAt(segments, name) }
    catch { /* leave empty */ }
    const properties = stripDecorations(rawProperties)

    const content: PairedLayerContent = { name, properties, children }
    const sig = await computeLayerSig(content)
    return { sig, content }
  }

  const root = await visit(parentSegments, tileName)
  if (!root) throw new Error(`No layer found for tile "${tileName}"`)
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
