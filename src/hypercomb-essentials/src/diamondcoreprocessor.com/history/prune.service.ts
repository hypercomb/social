// diamondcoreprocessor.com/history/prune.service.ts
//
// PRUNE — the only place in the hive where a tile can actually be destroyed.
//
// ── Why it is a place and not a verb ──────────────────────────────────
//
// Every other delete in this system is a bookkeeping change: `/remove`
// drops a sig from the parent's `children`, the tile stops rendering, and
// nothing on disk is touched. That is deliberate — it makes undo trivial
// and it means no gesture, no keystroke, no misclick can ever cost the
// participant content.
//
// Which leaves the other half unowned: a hive accumulates every tile it has
// ever thrown away, invisibly and forever. Getting rid of that junk has to
// be possible, but the ability must never be lying around near the ordinary
// delete. So it is a MODE with its own layer. Prune mode paints the deleted
// tiles — the ones that are already gone — and while you are standing on
// that layer, and only there, Delete means destroy. You cannot reach this
// operation by pressing a key on your live hive; you have to walk onto the
// layer of things you already threw away.
//
// ── The two doors ─────────────────────────────────────────────────────
//
// The behaviour `prune` (hidden from autocomplete — see prune.queen.ts) and
// the toggle in the history window. Both land in the same mode; the history
// window is where deleted tiles belong, because deletion is history.
//
// ── What a purge actually does ────────────────────────────────────────
//
//   1. the tile's lineage bag — its own history, markers and all
//   2. every layer sig the tile ever held here, plus its whole branch
//   3. a RECEIPT, written to sign('receipts:prune') and stamped onto this
//      location's head marker
//
// Step 3 is not bookkeeping. Past revisions of THIS location still name the
// sigs step 2 destroyed, and after a purge those names resolve to nothing.
// The marker is the revision and its record was always an open shape, so
// the receipt rides there: history carries the account of what was removed,
// when, and what was refused. A transaction that destroys bytes is not
// finished until the record of it exists.
//
// ── What it refuses ───────────────────────────────────────────────────
//
// Layers are content-addressed, so byte-identical tiles in two different
// branches ARE one file. Before anything is removed, every candidate sig is
// checked against every other bag in the hive; a sig somebody else still
// references is SKIPPED and the receipt says so. The junk goes; a shared
// empty tile three branches over does not blank.
//
// Resources — images, note bodies, tile properties — are NOT purged. They
// are the most aggressively deduplicated content in the system and a wrong
// call there is unrecoverable, so this pass takes structure only and the
// receipt records them as retained. The tile is gone and cannot come back;
// its orphaned blobs stay collectable by a future sweep.

import { EffectBus, requestConfirm, type I18nProvider, type KeyMapLayer } from '@hypercomb/core'
import { I18N_IOC_KEY } from '@hypercomb/core'
import { ReceiptBuilder, describeReceipt, type Receipt } from '../assistant/receipt.js'
import { collectBranchNodes, collectPrunedTiles, type BranchNode, type PrunedTile } from './pruned-tiles.js'
import type { HistoryService, LayerContent } from './history.service.js'

/** Pool of meaning the receipts live in. COLON-CARRYING by rule: a bare word
 *  hashes to the same address as a same-named root tile (see
 *  core/pool-registry.ts), and `lineageKey` can never produce a colon, so
 *  this address is collision-proof by construction. */
export const PRUNE_RECEIPTS_MEANING = 'receipts:prune'

export const PRUNE_MODE = 'prune:active'
const OWNER = 'prune'
const KEYMAP_LAYER_ID = 'prune'

/** The key that can never be pressed. Prune mode re-declares
 *  `selection.remove` onto it, which — because the effective keymap keeps
 *  the HIGHEST-priority binding PER CMD — unbinds Delete from the ordinary
 *  remove for as long as the mode is up, and restores it on exit. Without
 *  this, Delete would fire BOTH the purge and a `/remove` against a head
 *  that no longer lists these tiles, minting a pointless marker. */
const UNREACHABLE_KEY = 'F24'

type Ioc = { get<T>(key: string): T | undefined }
const ioc = <T>(key: string): T | undefined => (globalThis as { ioc?: Ioc }).ioc?.get<T>(key)

type LineageLike = {
  explorerSegments?: () => readonly string[]
  explorerLabel?: () => string
}
type SelectionLike = {
  selected: ReadonlySet<string>
  clear: () => void
}
type StoreLike = {
  putResource: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getPool: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
}
type ModeRegistryLike = {
  enter(mode: string, owner: string): void
  exit(mode: string, owner: string): void
}
type BackGestureLike = {
  register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void
}

/** What one purge wrote down. Stored as a resource in the receipts pool and
 *  named from this location's head marker. */
export type PruneReceipt = {
  readonly kind: 'prune'
  readonly at: number
  /** Where the purge happened — the path as the participant reads it. */
  readonly path: readonly string[]
  readonly locationSig: string
  /** One row per tile the participant asked for. */
  readonly tiles: ReadonlyArray<{
    readonly name: string
    /** Layer sigs this tile's branch put up for removal. */
    readonly candidates: readonly string[]
    /** How many of them were actually gone from the flat root afterwards. */
    readonly removed: number
    /** Sigs left alone because another branch still references them. */
    readonly shared: readonly string[]
    /** Did its lineage bag go? */
    readonly bag: boolean
  }>
  readonly attempted: number
  readonly landed: number
  readonly skipped: Readonly<Record<string, number>>
  /** Always true for now — see the header note on resources. */
  readonly resourcesRetained: true
}

export class PruneService extends EventTarget {

  #active = false
  #locationSig = ''
  #segments: readonly string[] = []
  #tiles: PrunedTile[] = []
  #scanning = false
  #purging = false
  #dropBack: (() => void) | null = null

  get active(): boolean { return this.#active }
  get locationSig(): string { return this.#locationSig }
  get tiles(): readonly PrunedTile[] { return this.#tiles }
  /** The names the mode is painting — what a click can select. */
  get names(): readonly string[] { return this.#tiles.map(t => t.name) }

  constructor() {
    super()

    EffectBus.on('prune:mode-open', () => { void this.enter() })
    EffectBus.on('prune:mode-close', () => { this.exit() })
    EffectBus.on('prune:mode-toggle', () => { void this.toggle() })

    EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
      if (!this.#active) return
      if (cmd === 'prune.purge') void this.purgeSelection()
      if (cmd === 'prune.exit') this.exit()
    })

    // The mode belongs to ONE location. Walking anywhere else — including
    // into a deleted tile to see what was in it — leaves it, because the
    // ghosts on screen would otherwise be somebody else's.
    //
    // LOCATION-AWARE, not navigation-aware. `navigation:guard-start` fires
    // for things that are not a move: the selection set is canonically the
    // URL, so CLEARING a selection (which this mode does on entry) counts as
    // a navigation and closed the mode a moment after it opened. The cursor
    // reports the location itself — compare it, and only leave when the
    // participant has actually gone somewhere else.
    EffectBus.on<{ locationSig?: string }>('history:cursor-changed', (state) => {
      if (!this.#active) return
      const to = String(state?.locationSig ?? '')
      if (!to || to === this.#locationSig) return
      this.exit()
    })
  }

  // ── mode ──────────────────────────────────────────────────────────

  readonly toggle = async (): Promise<void> => {
    if (this.#active) this.exit()
    else await this.enter()
  }

  readonly enter = async (): Promise<void> => {
    if (this.#scanning) return
    const history = ioc<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return

    const segments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const locationSig = await history.sign({ explorerSegments: () => [...segments] }).catch(() => '')
    if (!locationSig) return

    this.#scanning = true
    try {
      this.#tiles = await this.#scan(history, locationSig)
    } finally {
      this.#scanning = false
    }

    this.#locationSig = locationSig
    this.#segments = segments
    this.#active = true

    // Whatever was picked on the LIVE hive is not what is on screen now.
    // Carrying it in would let a Delete land on names this layer never
    // showed — counted as skips, but the participant would be pressing
    // destroy against a set they cannot see.
    ioc<SelectionLike>('@diamondcoreprocessor.com/SelectionService')?.clear()

    // Clicks PICK instead of walking. `select:mode` is the shared arming
    // signal the touch picker already uses — the overlay stops navigating
    // and taps become selection toggles — so prune mode mints no picking
    // of its own.
    EffectBus.emit('select:mode', { active: true })
    ioc<ModeRegistryLike>('@diamondcoreprocessor.com/ModeRegistry')?.enter(PRUNE_MODE, OWNER)
    this.#armKeys()
    this.#dropBack = ioc<BackGestureLike>('@diamondcoreprocessor.com/BackGesture')?.register({
      owner: OWNER,
      active: () => this.#active,
      back: () => this.exit(),
    }) ?? null

    this.#announce()
    if (this.#tiles.length === 0) {
      EffectBus.emit('toast:show', { type: 'tip', message: this.#t('prune.empty', 'Nothing has been deleted here.') })
    }
  }

  readonly exit = (): void => {
    if (!this.#active) return
    this.#active = false
    this.#tiles = []
    this.#locationSig = ''
    this.#segments = []
    EffectBus.emit('select:mode', { active: false })
    EffectBus.emit('keymap:remove-layer', { id: KEYMAP_LAYER_ID })
    ioc<ModeRegistryLike>('@diamondcoreprocessor.com/ModeRegistry')?.exit(PRUNE_MODE, OWNER)
    this.#dropBack?.()
    this.#dropBack = null
    ioc<SelectionLike>('@diamondcoreprocessor.com/SelectionService')?.clear()
    this.#announce()
  }

  /**
   * The layer of deleted tiles, for the renderer.
   *
   * A layer is `{name, children}` and nothing else, so the deleted set IS
   * one — the same shape, resolving through the same child-name pipeline,
   * painting the same hexagons with the same images. Nothing about the
   * render path is special-cased for this mode; it is handed a different
   * layer, exactly as rewinding hands it a different layer.
   *
   * Returns null when the mode is off or the caller is asking about another
   * location, so show-cell can call it unconditionally.
   */
  readonly layerFor = (locationSig: string): LayerContent | null => {
    if (!this.#active || !locationSig || locationSig !== this.#locationSig) return null
    const name = String(
      ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerLabel?.() ?? '',
    )
    // Newest sig per name: the tile as it last stood before it was removed.
    const children = this.#tiles.map(t => t.sigs[t.sigs.length - 1]).filter(Boolean)
    return { name, children }
  }

  // ── the purge ─────────────────────────────────────────────────────

  /**
   * Destroy the selected deleted tiles. The single destructive path.
   *
   * Live tiles caught in the selection are NOT purged — they are counted as
   * skips with a reason, which is the whole point of running this through a
   * receipt: the participant is told the operation did less than the
   * selection implied, in the same breath as the count.
   */
  readonly purgeSelection = async (): Promise<Receipt | null> => {
    if (!this.#active || this.#purging) return null
    const selection = ioc<SelectionLike>('@diamondcoreprocessor.com/SelectionService')
    const picked = [...(selection?.selected ?? [])]
    if (picked.length === 0) {
      EffectBus.emit('toast:show', { type: 'tip', message: this.#t('prune.nothing-picked', 'Pick the tiles to destroy first.') })
      return null
    }

    const byName = new Map(this.#tiles.map(t => [t.name, t]))
    const targets = picked.map(name => byName.get(name)).filter((t): t is PrunedTile => !!t)
    const notDeleted = picked.length - targets.length

    // Keys, not sentences — the dialog runs them through `| t` itself
    // (same contract as confirmRemoval).
    const confirmed = await requestConfirm({
      title: 'prune.confirm-title',
      message: 'prune.confirm-message',
      messageParams: { count: targets.length, name: targets[0]?.name ?? '' },
      warning: 'prune.confirm-warning',
      confirmLabel: 'prune.confirm-label',
      danger: true,
    })
    if (!confirmed) return null

    this.#purging = true
    try {
      const receipt = await this.#purge(targets, notDeleted)
      EffectBus.emit('toast:show', {
        type: receipt.landed > 0 ? 'tip' : 'warning',
        message: describeReceipt(receipt, this.#t('prune.verb-destroyed', 'destroyed'), this.#t('prune.noun-tile', 'tile'), {
          'still-here': n => this.#t('prune.skip-still-here', `${n} still live`, { count: n }),
          'shared': n => this.#t('prune.skip-shared', `${n} shared with another branch`, { count: n }),
          'unreadable': n => this.#t('prune.skip-unreadable', `${n} unreadable`, { count: n }),
        }),
      })
      return receipt
    } finally {
      this.#purging = false
    }
  }

  async #purge(targets: readonly PrunedTile[], notDeleted: number): Promise<Receipt> {
    const history = ioc<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const builder = new ReceiptBuilder()
    for (let i = 0; i < notDeleted; i++) builder.skipped('still-here')
    const rows: Array<PruneReceipt['tiles'][number]> = []

    if (!history) {
      for (const _ of targets) builder.skipped('unreadable')
      return builder.build()
    }

    // 1. The full candidate set: every sig each target ever held here, plus
    //    everything nested under those layers, each tied to the PLACE it
    //    sits at. A deleted tile takes its branch with it, so the branch is
    //    what has to be accounted for.
    const branchByName = new Map<string, BranchNode[]>()
    const allCandidates = new Set<string>()
    for (const tile of targets) {
      const nodes = await collectBranchNodes(
        tile.sigs,
        [...this.#segments, tile.name],
        sig => history.getLayerBySig(sig),
      )
      branchByName.set(tile.name, nodes)
      for (const node of nodes) for (const sig of node.sigs) allCandidates.add(sig)
    }

    // 2. Remove the BAGS FIRST — before asking who else needs these bytes.
    //
    //    Not an optimisation: a bag address is `sign(lineageKey(segments))`,
    //    so it names one place in this hive and removing it can never touch
    //    a look-alike elsewhere. But every one of those bags is FULL of
    //    markers pointing at exactly the sigs we are about to ask about, so
    //    a reference walk run first finds the tile's own history and
    //    concludes that everything is shared — the purge then reports
    //    success having destroyed nothing (observed: `shared: [beta's own
    //    sig]`, `removed: 0`). Take the tile's own history out of the world
    //    first, and what the walk finds afterwards genuinely belongs to
    //    somebody else.
    const bagGoneByName = new Map<string, boolean>()
    for (const tile of targets) {
      let any = false
      for (const node of branchByName.get(tile.name) ?? []) {
        if (node.segments.length === 0) continue
        const bagSig = await history.sign({ explorerSegments: () => [...node.segments] }).catch(() => '')
        if (!bagSig) continue
        if (await history.removeLineageBag(bagSig).catch(() => false)) any = true
      }
      bagGoneByName.set(tile.name, any)
    }

    // 3. Who else needs these bytes. One walk for the whole batch, now that
    //    the purged tiles' own histories are gone.
    const shared = await history.sigsReferencedOutside(this.#locationSig, [...allCandidates])
      .catch(() => new Set<string>())

    // 4. Remove the layer bytes nobody else claims.
    for (const tile of targets) {
      const branch: string[] = []
      for (const node of branchByName.get(tile.name) ?? []) for (const sig of node.sigs) branch.push(sig)
      const purgeable = branch.filter(sig => !shared.has(sig))
      const withheld = branch.filter(sig => shared.has(sig))
      const bagGone = bagGoneByName.get(tile.name) ?? false

      const removed = await history.removeContentSigs(purgeable).catch(() => 0)
      // Landed means SOMETHING of this tile is gone. A tile whose every sig
      // is shared and whose bag was already absent did not land — and the
      // receipt names which of the two it was rather than reporting a
      // number the participant cannot explain.
      if (removed === 0 && !bagGone) builder.skipped(withheld.length > 0 ? 'shared' : 'unreadable')
      else builder.landed()

      rows.push({
        name: tile.name,
        candidates: purgeable,
        removed,
        shared: withheld,
        bag: bagGone,
      })
    }
    const receipt = builder.build()

    // 5. Finish the transaction: write the receipt and name it from the
    //    head marker. Best-effort by design — the bytes are already gone,
    //    and a receipt that failed to write must not be reported as a
    //    failed purge.
    await this.#writeReceipt(history, rows, receipt).catch(() => { /* recorded below */ })

    // 6. Re-scan so the layer on screen reflects what is actually left.
    this.#tiles = await this.#scan(history, this.#locationSig)
    ioc<SelectionLike>('@diamondcoreprocessor.com/SelectionService')?.clear()
    this.#announce()
    EffectBus.emit('prune:purged', { count: receipt.landed })

    return receipt
  }

  async #writeReceipt(
    history: HistoryService,
    rows: PruneReceipt['tiles'],
    receipt: Receipt,
  ): Promise<void> {
    const store = ioc<StoreLike>('@hypercomb.social/Store')
    if (!store?.putResource || !store.getPool) return

    const record: PruneReceipt = {
      kind: 'prune',
      at: Date.now(),
      path: [...this.#segments],
      locationSig: this.#locationSig,
      tiles: rows,
      attempted: receipt.attempted,
      landed: receipt.landed,
      skipped: Object.fromEntries(receipt.skipped),
      resourcesRetained: true,
    }
    const bytes = new TextEncoder().encode(JSON.stringify(record))
    const blob = new Blob([bytes], { type: 'application/json' })
    const sig = await store.putResource(blob, { emit: false })

    // The receipt is a resource like any other, and it also belongs in its
    // own pool so a future audit can read every prune ever run without
    // walking history. Same sig either way — content-addressed, stored once.
    try {
      const pool = await store.getPool(PRUNE_RECEIPTS_MEANING)
      if (pool) {
        const handle = await pool.getFileHandle(sig, { create: true })
        const writable = await handle.createWritable()
        try { await writable.write(bytes.buffer as ArrayBuffer) } finally { await writable.close() }
      }
    } catch { /* the resource write above is the durable copy */ }

    // Stamp the head marker. THIS is what makes the transaction finished:
    // the revision the participant is standing on now carries the account
    // of what was destroyed underneath it.
    const markers = await history.listLayers(this.#locationSig).catch(() => [])
    const head = markers[markers.length - 1] as { filename?: string } | undefined
    if (head?.filename) {
      await history.stampMarkerSig(this.#locationSig, head.filename, 'prune', sig)
    }
  }

  // ── internals ─────────────────────────────────────────────────────

  async #scan(history: HistoryService, locationSig: string): Promise<PrunedTile[]> {
    const markers = await history.listLayers(locationSig).catch(() => [])
    const tiles = await collectPrunedTiles({
      markers,
      readLayer: sig => history.getLayerBySig(sig),
      // At the root, "every revision of this location" is every change ever
      // made in the hive. Hand the scan a real yield so opening the mode
      // never freezes the canvas mid-scan.
      yieldNow: () => new Promise<void>(r => setTimeout(r, 0)),
    }).catch(() => [])

    // THE RECEIPTS ARE THE TOMBSTONES.
    //
    // Purging cannot make a name stop appearing in this location's PAST
    // revisions — those markers are history and history is not rewritten.
    // Worse, an empty leaf's layer is literally `{"name":"beta"}`, so any
    // later read that warms a cold bag re-mints byte-identical content at
    // the same sig: the tile stays destroyed (no bag, not in the head) but
    // its 15 bytes come back, and a scan reading only markers would offer
    // it up for destruction again, for ever.
    //
    // So the scan asks what has already been accounted for. Matched by NAME
    // and TIME, never by sig: content-addressing means a freshly created and
    // re-deleted `beta` would hash to exactly the sig the old one had, and a
    // sig-keyed tombstone would hide a real deletion. A deletion that
    // happened BEFORE the purge is settled; one that happened after is new.
    const purgedAt = await this.#purgedNamesAt(locationSig)
    if (purgedAt.size === 0) return tiles
    return tiles.filter(t => t.lastSeenAt > (purgedAt.get(t.name) ?? -Infinity))
  }

  /** Name → the time of the most recent purge that took it, from every
   *  receipt written at this location. */
  async #purgedNamesAt(locationSig: string): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    const store = ioc<StoreLike>('@hypercomb.social/Store')
    if (!store?.getPool) return out
    let pool: FileSystemDirectoryHandle | null = null
    try { pool = await store.getPool(PRUNE_RECEIPTS_MEANING) } catch { return out }
    if (!pool) return out
    try {
      for await (const [, handle] of (pool as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>
      }).entries()) {
        if (handle.kind !== 'file') continue
        try {
          const text = await (await (handle as FileSystemFileHandle).getFile()).text()
          const record = JSON.parse(text) as PruneReceipt
          if (record?.kind !== 'prune' || record.locationSig !== locationSig) continue
          const at = Number(record.at ?? 0)
          for (const row of record.tiles ?? []) {
            const previous = out.get(row.name) ?? 0
            if (at > previous) out.set(row.name, at)
          }
        } catch { /* unreadable receipt — it can only fail to hide something */ }
      }
    } catch { /* pool unreadable — the scan is simply un-tombstoned */ }
    return out
  }

  #armKeys(): void {
    const layer: KeyMapLayer = {
      id: KEYMAP_LAYER_ID,
      // Above the tile-edit layer (5) so Delete belongs to the mode for as
      // long as the mode is up, and nobody else's binding outranks it.
      priority: 20,
      bindings: [
        {
          cmd: 'prune.purge',
          sequence: [[{ key: 'delete' }, { key: 'backspace' }]],
          description: 'Destroy the selected deleted tiles permanently',
          category: 'History',
          pierce: true,
        },
        {
          cmd: 'prune.exit',
          sequence: [[{ key: 'Escape' }]],
          description: 'Leave the layer of deleted tiles',
          category: 'History',
          pierce: true,
        },
        {
          // Not a feature — the unbinding. See UNREACHABLE_KEY.
          cmd: 'selection.remove',
          sequence: [[{ key: UNREACHABLE_KEY }]],
          description: 'Remove selected tiles (suspended in prune mode)',
          category: 'History',
        },
      ],
    }
    EffectBus.emit('keymap:add-layer', { layer })
  }

  #announce(): void {
    const detail = { active: this.#active, count: this.#tiles.length, names: this.names }
    EffectBus.emit('prune:mode-changed', detail)
    this.dispatchEvent(new CustomEvent('change', { detail }))
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
    return i18n?.t(key, params) ?? fallback
  }
}

const _prune = new PruneService()
window.ioc.register('@diamondcoreprocessor.com/PruneService', _prune)

// NOTHING RE-READS THE LOCATION AFTER A PURGE — deliberately.
//
// A cursor refresh looked like the polite thing to do here (the history
// window is showing this location's rows), and it is exactly wrong: a purge
// adds and removes no markers, so the row list cannot have gone stale, while
// reloading the cursor re-warms every historical layer at this location —
// including the ones just destroyed. An empty leaf's layer is 15 bytes of
// `{"name":"x"}`, cheap to re-mint from a warm cache, and the warm pass put
// them straight back at the same sigs (observed: file gone at the end of the
// purge, present again five seconds later). The tile stayed destroyed either
// way — its bag was gone and the receipt tombstoned it — but the bytes the
// participant asked to be rid of came back.
//
// If some other read does re-mint a purged sig, the receipt is what keeps it
// out of the listing: see #purgedNamesAt.
