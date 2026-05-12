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
const TILE_ACTION_EXPOSE = 'expose'
const TILE_ACTION_SYNC = 'sync'
const SHARE_ACCEPT_EFFECT = 'paired-channel:accept-share'
const SHARE_APPROVE_EFFECT = 'paired-channel:approve-share'
const SHARE_REJECT_EFFECT = 'paired-channel:reject-share'

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

// Inline SVG — outline arrow leaving a hex cell, neutral stroke.
// Matches the existing icon size/profile used by tile-actions.drone.
const EXPOSE_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
  <path d="M12 4v9"/>
  <path d="M8 8l4-4 4 4"/>
  <path d="M5 14h14v6H5z"/>
</svg>`.trim()

// Same icon, mirror direction — used for the sync (incoming) action.
const SYNC_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
  <path d="M12 20v-9"/>
  <path d="M16 16l-4 4-4-4"/>
  <path d="M5 4h14v6H5z"/>
</svg>`.trim()

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

interface AcceptSharePayload {
  channelId: string
  share: ShareState
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
    SHARE_ACCEPT_EFFECT,
    SHARE_APPROVE_EFFECT,
    SHARE_REJECT_EFFECT,
  ]

  protected override emits: string[] = ['toast:show']

  // ── lifecycle ─────────────────────────────────────────────────────

  constructor() {
    super()
    this.#registerIcon()

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (!payload?.action) return
      if (payload.action === TILE_ACTION_EXPOSE) { void this.#onExpose(payload.label); return }
      if (payload.action === TILE_ACTION_SYNC) { void this.#onSync(payload.label); return }
    })

    this.onEffect<{ channelId: string; share: ShareState }>(
      PAIRED_CHANNEL_EFFECTS.shareRequestReceived,
      (payload) => {
        if (!payload?.share) return
        this.#offerApproval(payload.channelId, payload.share)
      },
    )

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

    this.onEffect<AcceptSharePayload>(SHARE_ACCEPT_EFFECT, (payload) => {
      if (!payload?.share) return
      void this.#acceptShare(payload.channelId, payload.share)
    })

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
  }

  // No per-pulse work; all behavior is event-driven.
  public override heartbeat = async (): Promise<void> => { /* noop */ }

  // ── expose path ────────────────────────────────────────────────────

  #registerIcon(): void {
    const registry = window.ioc.get('@hypercomb.social/IconProviderRegistry') as IconProviderRegistry | undefined
    registry?.add({
      name: EXPOSE_ICON_NAME,
      owner: '@diamondcoreprocessor.com/ExposeDrone',
      svgMarkup: EXPOSE_ICON_SVG,
      profile: 'public',
      hoverTint: 0xa6e3a1,
      labelKey: 'action.expose',
      descriptionKey: 'action.expose.description',
    })
    registry?.add({
      name: SYNC_ICON_NAME,
      owner: '@diamondcoreprocessor.com/ExposeDrone',
      svgMarkup: SYNC_ICON_SVG,
      profile: 'public',
      hoverTint: 0x80c8ff,
      labelKey: 'action.sync',
      descriptionKey: 'action.sync.description',
    })
  }

  async #onExpose(tileLabel: string): Promise<void> {
    const channel = this.#firstJoinedChannel()
    if (!channel) {
      this.#toast('warning', 'No paired channel',
        'Set hypercomb.paired-channel.location and hypercomb.paired-channel.secret in localStorage, then reload.')
      return
    }

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
   * sees a visible tile (with empty children) and a sync icon. Clicking
   * the sync icon resolves to #onSync, which fills the full subtree
   * and drops the facade flag.
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
    if (!dir) return

    const targetName = share.branchName
    if (!targetName) return

    // Skip if the tile already exists locally (source-side echo).
    try {
      await dir.getDirectoryHandle(targetName, { create: false })
      return // already present — do nothing
    } catch { /* not present, proceed */ }

    let cellDir: FileSystemDirectoryHandle
    try {
      cellDir = await dir.getDirectoryHandle(targetName, { create: true })
    } catch (err) {
      console.warn('[expose] facade: getDirectoryHandle failed', targetName, err)
      return
    }

    const meta: FacadeMetadata = {
      facade: true,
      channelId,
      branchSig: share.branchSig,
      approvalId: share.approvalId,
    }

    try {
      await writeCellProperties(cellDir, meta as unknown as Record<string, unknown>)
    } catch (err) {
      console.warn('[expose] facade: writeCellProperties failed', targetName, err)
      return
    }

    // Trigger render of the new tile.
    EffectBus.emit('cell:added', { cell: targetName })
  }

  /**
   * Sync icon click handler. Reads the tile's facade metadata from
   * 0000, calls drone.materialiseFromSig to recursively fill the
   * subtree, then drops `facade: true` from 0000 so the tile becomes
   * a normal cell.
   *
   * No-op if the tile isn't a facade — the sync icon is registered
   * for every tile in v0 (no per-tile filtering until shader-side
   * facade rendering lands), so clicks on plain tiles fall through
   * silently rather than misbehaving.
   */
  async #onSync(tileLabel: string): Promise<void> {
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
      // Plain tile, not a facade — sync icon is a no-op here.
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

    // Materialise into the parent directory (so the tile's content
    // overwrites its own folder rather than nesting another copy).
    let result: { written: number; missing: string[] }
    try {
      result = await drone.materialiseFromSig(channelId, branchSig, dir)
    } catch (err) {
      this.#toast('warning', 'Sync failed', String((err as Error)?.message ?? err))
      return
    }

    // Drop the facade flag so the tile becomes a normal cell.
    try {
      await writeCellProperties(cellDir, { facade: false })
    } catch (err) {
      console.warn('[expose] sync: failed to drop facade flag', err)
    }

    if (result.missing.length > 0) {
      this.#toast('tip', 'Synced (partial)',
        `Wrote ${result.written} layer(s). ${result.missing.length} sig(s) still missing — they may arrive later.`)
    } else {
      this.#toast('success', 'Synced',
        `"${tileLabel}" + ${result.written - 1} descendant(s) filled in.`)
    }

    const approvalId = typeof props['approvalId'] === 'string' ? props['approvalId'] : ''
    if (approvalId) {
      void drone.markPulled(channelId, approvalId)
    }
  }

  async #acceptShare(channelId: string, share: ShareState): Promise<void> {
    const drone = this.#pairedChannelDrone()
    if (!drone) {
      this.#toast('warning', 'Sync failed', 'PairedChannelDrone is not available.')
      return
    }
    const lineage = window.ioc.get('@hypercomb.social/Lineage') as LineageLike | undefined
    const dir = await lineage?.explorerDir?.()
    if (!dir) {
      this.#toast('warning', 'Sync failed', 'No explorer directory for the current lineage.')
      return
    }

    // Verify root layer is in the buffer. If it's not, we can't
    // materialise — surface and stop. Recoverable: re-fire expose
    // on the source side, or wait for late `layer` events.
    if (!drone.layerOf(channelId, share.branchSig)) {
      this.#toast('warning', 'Sync failed',
        `Root layer ${share.branchSig.slice(0, 8)} hasn't arrived yet. Wait a moment and try again.`)
      return
    }

    let result: { written: number; missing: string[] }
    try {
      result = await drone.materialiseFromSig(channelId, share.branchSig, dir)
    } catch (err) {
      this.#toast('warning', 'Sync failed', String((err as Error)?.message ?? err))
      return
    }

    if (result.written === 0) {
      this.#toast('warning', 'Sync failed',
        `Wrote zero layers — ${result.missing.length} sig(s) missing from the buffer.`)
      return
    }

    // Notify the rest of the renderer that the root cell now exists at
    // the current location so it picks up + renders the new tile.
    EffectBus.emit('cell:added', { cell: share.branchName })

    if (result.missing.length > 0) {
      this.#toast('tip', 'Synced (partial)',
        `Wrote ${result.written} layer(s). ${result.missing.length} sig(s) still missing — they may arrive later.`)
    } else {
      this.#toast('success', 'Synced',
        `"${share.branchName}" + ${result.written - 1} descendant(s) landed at the current location.`)
    }

    // Decrement the host's cap counter — best-effort.
    if (share.approvalId) {
      void drone.markPulled(channelId, share.approvalId)
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
    const properties = await readCellProperties(dir)
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

// Quiet TS over unused exports for v0 — sync icon is staged for later
// when the sync icon attaches to receiver-side ghost tiles instead of
// the toast surface.
void SYNC_ICON_SVG

// ── registration ─────────────────────────────────────────────────────

const _exposeDrone = new ExposeDrone()
window.ioc.register('@diamondcoreprocessor.com/ExposeDrone', _exposeDrone)
