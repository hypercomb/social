// diamondcoreprocessor.com/core/clipboard/clipboard.worker.ts
import { Worker, EffectBus, hypercomb } from '@hypercomb/core'
import type { ClipboardService, ClipboardOp } from './clipboard.service.js'
import { childNamesOf, childLayerOf, resolveLayerAt, flattenLayerTree } from '../history/layer-placement.js'
import { readTilePropsIndex, writeTilePropsIndex, cellLocationSig } from '../editor/tile-properties.js'

interface ClipboardEntry {
  label: string
  sourceSegments: readonly string[]
}

const META_FILE = '__meta__'

interface SelectionLike {
  readonly selected: ReadonlySet<string>
  clear(): void
}

interface LineageLike {
  explorerSegments(): readonly string[]
  readonly domain?: unknown
}

/** Minimal layer shape this worker reads — `name` identifies the cell,
 *  `children` holds child-layer sigs (the merkle backbone). Other slots
 *  (properties, notes, …) ride along via the index signature so a clone
 *  preserves them and a children-edit can spread them back unchanged. */
interface LayerLike {
  name?: string
  children?: readonly string[]
  [slot: string]: unknown
}

interface HistoryServiceLike {
  sign(lineage: { domain?: unknown; explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  commitLayer(locationSig: string, layer: LayerLike): Promise<string>
  getLayerBySig(sig: string): Promise<LayerLike | null>
}

interface LayerCommitterLike {
  update(
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ): Promise<string>
  importTree(
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
  ): Promise<void>
}

interface StoreLike {
  readonly clipboard: FileSystemDirectoryHandle
  getResource?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob) => Promise<string>
}

export class ClipboardWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'clipboard'

  public override description =
    'Captures selected cells into clipboard and pastes them at the current location.'

  protected override listens = [
    'controls:action',
    'keymap:invoke',
  ]

  protected override emits = [
    'clipboard:captured',
    'clipboard:paste-start',
    'clipboard:paste-done',
    'cell:added',
    'cell:removed',
  ]

  constructor() {
    super()

    EffectBus.on<{ action: string; targetSegments?: string[] }>('controls:action', (payload) => {
      if (!payload?.action) return
      switch (payload.action) {
        case 'copy': void this.#capture('copy'); break
        case 'cut': void this.#capture('cut'); break
        case 'paste': void this.#paste(this.#boundTarget(payload.targetSegments)); break
        case 'clear-clipboard': void this.#clearClipboard(); break
      }
    })

    EffectBus.on<{ cmd: string; targetSegments?: string[] }>('keymap:invoke', (payload) => {
      if (!payload?.cmd) return
      switch (payload.cmd) {
        case 'clipboard.copy': void this.#capture('copy'); break
        case 'layout.cutCells': void this.#capture('cut'); break
        case 'clipboard.paste': void this.#paste(this.#boundTarget(payload.targetSegments)); break
      }
    })

    // Place specific clipboard tiles at a BOUND location — the non-navigating
    // side panel's per-item "place" button. The panel passes the location it is
    // docked over as `targetSegments`, captured at click time; the placement
    // primitive (#placeItems) writes there and nowhere else.
    EffectBus.on<{ labels?: string[]; targets?: Record<string, number>; targetSegments?: string[] }>('clipboard:place-items', (payload) => {
      const labels = Array.isArray(payload?.labels) ? payload!.labels! : []
      const targets = (payload?.targets && typeof payload.targets === 'object') ? payload.targets : undefined
      if (labels.length > 0) void this.#placeLabels(labels, targets, this.#boundTarget(payload?.targetSegments))
    })

    // Drop specific clipboard tiles WITHOUT placing them — the side panel's
    // per-item "×" discard. Persists like validate() so a discarded item
    // doesn't return on the next OPFS restore.
    EffectBus.on<{ labels?: string[] }>('clipboard:discard-items', (payload) => {
      const labels = Array.isArray(payload?.labels) ? payload!.labels! : []
      if (labels.length > 0) void this.#discardLabels(labels)
    })

    // Place explicit (label + sourceSegments) entries at the current location —
    // the side panel's per-item place from a DRILLED level, where each row is a
    // child of a clipboard tile (a live source-tree pointer), not a top-level
    // clipboard entry. The label alone can't be matched against the clipboard,
    // so the panel hands the full source path. Placing a drilled child never
    // consumes anything from the clipboard.
    EffectBus.on<{ entries?: { label?: string; sourceSegments?: string[] }[]; targets?: Record<string, number>; targetSegments?: string[] }>(
      'clipboard:place-entries',
      (payload) => {
        const raw = Array.isArray(payload?.entries) ? payload!.entries! : []
        const entries: ClipboardEntry[] = raw
          .filter((e): e is { label: string; sourceSegments?: string[] } => !!e && typeof e.label === 'string')
          .map(e => ({ label: e.label, sourceSegments: Array.isArray(e.sourceSegments) ? [...e.sourceSegments] : [] }))
        const targets = (payload?.targets && typeof payload.targets === 'object') ? payload.targets : undefined
        if (entries.length > 0) void this.#placeEntries(entries, targets, this.#boundTarget(payload?.targetSegments))
      },
    )


    // Restore clipboard from OPFS once Store is initialized
    const tryRestore = (): void => {
      const store = this.#store
      const svc = this.#clipboardSvc
      if (!store?.clipboard || !svc) {
        setTimeout(tryRestore, 200)
        return
      }
      void this.#restoreFromOpfs()
    }
    setTimeout(tryRestore, 200)
  }

  protected override act = async (): Promise<void> => { }

  // ── helpers ───────────────────────────────────────────

  get #clipboardSvc(): ClipboardService | undefined {
    return get('@diamondcoreprocessor.com/ClipboardService') as ClipboardService | undefined
  }

  get #lineage(): LineageLike | undefined {
    return get('@hypercomb.social/Lineage') as LineageLike | undefined
  }

  get #store(): StoreLike | undefined {
    return get('@hypercomb.social/Store') as StoreLike | undefined
  }

  get #history(): HistoryServiceLike | undefined {
    return get('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined
  }

  get #committer(): LayerCommitterLike | undefined {
    return get('@diamondcoreprocessor.com/LayerCommitter') as LayerCommitterLike | undefined
  }

  get #selection(): SelectionLike | undefined {
    const svc = get('@diamondcoreprocessor.com/SelectionService') as SelectionLike | undefined
    if (svc && svc.selected.size > 0) return svc
    return undefined
  }

  #selectedLabels(): string[] {
    const svc = get('@diamondcoreprocessor.com/SelectionService') as SelectionLike | undefined
    if (svc && svc.selected.size > 0) return Array.from(svc.selected)

    const tsd = get('@diamondcoreprocessor.com/TileSelectionDrone') as
      { selectedLabels?: string[] } | undefined
    return tsd?.selectedLabels ?? []
  }

  /** The BOUND paste/place target: the location captured at the moment of
   *  intent. The shell (clipboard panel, context menu) passes the location it
   *  was acting over as `targetSegments`; for keyboard/command paste we snapshot
   *  the live explorer path HERE, at synchronous handler entry (keypress time IS
   *  intent time). Either way the result is frozen before any `await`, so a
   *  paste can never drift to wherever navigation happens to be when the async
   *  placement finally runs. */
  #boundTarget(explicit?: readonly string[]): string[] {
    if (Array.isArray(explicit)) return [...explicit]
    return [...(this.#lineage?.explorerSegments() ?? [])]
  }

  #sameSegments(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((s, i) => s === b[i])
  }

  get #cursor(): { currentLayerSig?: string; state?: { rewound?: boolean } } | undefined {
    return get('@diamondcoreprocessor.com/HistoryCursorService') as
      { currentLayerSig?: string; state?: { rewound?: boolean } } | undefined
  }

  /** Editing is refused while the history cursor is rewound — scrub-back is
   *  view-only (you're looking at a past state). LayerCommitter.#commit
   *  silently returns in that case and update() reports the unchanged head as
   *  success, so without this guard cut/paste would capture to the clipboard
   *  and eager-unmount the tile yet never commit — a true silent no-op the
   *  user reads as "nothing happens" (the intended RewoundCommitDrone toast is
   *  dead: nothing emits `history:promoted`). Surface a toast and decline
   *  BEFORE any half-action runs. Returns true when blocked. */
  #blockedByRewound(verb: string): boolean {
    if (!this.#cursor?.state?.rewound) return false
    EffectBus.emit('toast:show', {
      type: 'info',
      title: 'Viewing history',
      message: `Can't ${verb} while scrubbed back — return to the latest (Restore) to edit.`,
    })
    return true
  }

  /** Resolve the layer at `segs` robustly enough to compute survivors / existing
   *  children for a children-slot SET. resolveLayerAt walks currentLayerAt up
   *  the parent chain, but currentLayerAt reads `#latestSigByLineage`, which can
   *  be COLD even for a location that's plainly on screen: the renderer resolves
   *  the current location through the CURSOR (currentLayerSig → getLayerBySig
   *  from the pool), warming a different cache. When the chain misses and `segs`
   *  is the location the user is viewing, fall back to the cursor — the exact
   *  source that proves the tiles are rendered. Without this, a cold cache made
   *  cut/paste silently no-op (the `if (!parent)` guard skipped the commit). */
  async #resolveParentLayer(
    history: HistoryServiceLike,
    segs: readonly string[],
    currentSegs: readonly string[],
  ): Promise<LayerLike | null> {
    const viaChain = await resolveLayerAt(history, this.#lineage?.domain, segs)
    if (viaChain) return viaChain
    const sameLocation =
      segs.length === currentSegs.length && segs.every((s, i) => s === currentSegs[i])
    if (sameLocation) {
      const sig = this.#cursor?.currentLayerSig
      if (sig) {
        const layer = await history.getLayerBySig(sig)
        if (layer) return layer
      }
    }
    return null
  }

  // ── capture ───────────────────────────────────────────
  // copy: record labels + source segments, leave folders in place.
  // cut:  move folders out of source into store.clipboard, then record
  //       remove ops. After cut, the source no longer holds the cells —
  //       refresh and history replay see them as truly gone.

  async #capture(op: ClipboardOp): Promise<void> {
    const labels = this.#selectedLabels()
    if (labels.length === 0) return

    // A fresh capture replaces the clipboard wholesale — any nested-discard
    // exclusions from the previous contents are now meaningless, so reset them
    // before the new entries land (the panel re-reads them on clipboard:changed).
    clearExclusions()

    const lineage = this.#lineage
    const baseSegments = lineage?.explorerSegments() ?? []

    if (op === 'cut') {
      const history = this.#history
      const committer = this.#committer
      if (!lineage || !history || !committer) return

      // Cut commits (drops the leaves from the parent). That commit is refused
      // while the cursor is rewound, so bail with feedback before capturing —
      // otherwise the clipboard fills and tiles eager-unmount with no commit.
      if (this.#blockedByRewound('cut')) return

      // Cut = drop the cells from each source parent's `children` slot.
      // No bytes move: the cell's own history bag stays addressable by
      // its lineage sig, so paste re-homes it at the target. Labels may
      // be `/`-separated paths — group leaves by their parent so each
      // affected parent gets exactly ONE layer commit.
      const groups = new Map<string, { parentSegs: string[]; leaves: Set<string> }>()
      const moved: ClipboardEntry[] = []
      for (const label of labels) {
        const pathSegs = label.split('/').filter(Boolean)
        if (pathSegs.length === 0) continue
        const leaf = pathSegs[pathSegs.length - 1]
        const parentSegs = [...baseSegments, ...pathSegs.slice(0, -1)]
        const key = parentSegs.join('/')
        const group = groups.get(key) ?? { parentSegs, leaves: new Set<string>() }
        group.leaves.add(leaf)
        groups.set(key, group)
        moved.push({ label: leaf, sourceSegments: parentSegs })
      }
      if (moved.length === 0) return

      this.#clipboardSvc?.captureEntries(moved, 'cut')

      EffectBus.emit('fs:changed', { segments: [...baseSegments] })

      // ONE commit per affected parent. Survivors = current children
      // MINUS the cut leaves — the full surviving list, never a partial
      // one (a partial list passed to update() is a SET that wipes the
      // siblings it omits). Other parent slots ride along via spread.
      // Mirrors RemoveQueenBee.
      for (const { parentSegs, leaves } of groups.values()) {
        // Resolve the parent layer ROBUSTLY. The bare currentLayerAt reads
        // the parent's OWN history bag, which is empty for a location never
        // committed into (its content lives as a child sig in ITS parent,
        // pool-addressed) — so it returns null even when the layer plainly
        // renders. resolveLayerAt walks the parent chain to get the real
        // children list.
        const parent = await this.#resolveParentLayer(history, parentSegs, baseSegments)
        // No reliable parent read → DO NOT commit. survivors would be the
        // empty/partial list of siblings we couldn't see, and update() SETs
        // children, so committing would WIPE every tile we missed ("cut
        // tiles show, current tiles are gone"). Mirrors RemoveQueenBee's
        // `if (!parent) return` guard. The entries are already on the
        // clipboard, so nothing is lost — the cut just declines to mutate a
        // layer it cannot read.
        if (!parent) {
          console.warn(`[clipboard] cut skipped — parent layer unresolved at /${parentSegs.join('/')}`)
          continue
        }
        const survivors = (await childNamesOf(history, parent)).filter(n => !leaves.has(n))

        // Eager visual unmount; `viaUpdate` tells the committer's per-
        // event listener to skip queueing — the update() below IS the
        // atomic commit for this action.
        for (const leaf of leaves) {
          EffectBus.emit('cell:removed', { cell: leaf, segments: [...parentSegs], viaUpdate: true })
        }
        await committer.update(parentSegs, { ...parent, children: survivors })
      }

      this.#selection?.clear()

      EffectBus.emit('clipboard:captured', { labels: moved.map(e => e.label), op: 'cut' })

      await new hypercomb().act()

      void this.#persistMetaEntries('cut', moved)
      return
    }

    // copy: leave folders in place. Walk paths to record the exact source
    // parent per item so paste can find the original.
    const copyEntries: ClipboardEntry[] = []
    for (const label of labels) {
      const pathSegs = label.split('/').filter(Boolean)
      if (pathSegs.length === 0) continue
      const leaf = pathSegs[pathSegs.length - 1]
      copyEntries.push({
        label: leaf,
        sourceSegments: [...baseSegments, ...pathSegs.slice(0, -1)],
      })
    }
    if (copyEntries.length === 0) return
    this.#clipboardSvc?.captureEntries(copyEntries, 'copy')
    EffectBus.emit('clipboard:captured', { labels: copyEntries.map(e => e.label), op: 'copy' })
    void this.#persistMetaEntries('copy', copyEntries)
  }

  async #persistMetaEntries(op: ClipboardOp, entries: readonly ClipboardEntry[]): Promise<void> {
    const store = this.#store
    if (!store) return
    await writeMeta(store.clipboard, {
      op,
      items: entries.map(e => ({ label: e.label, sourceSegments: [...e.sourceSegments] })),
    })
  }

  // ── paste ─────────────────────────────────────────────
  // cut:  move folders from store.clipboard back to current explorer dir.
  // copy: copy folders from sourceSegments to current explorer dir.

  async #paste(boundTarget: readonly string[]): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    if (!clipboardSvc || clipboardSvc.isEmpty) return
    // Paste = place EVERY clipboard tile at the BOUND location (captured at
    // intent, not re-read here).
    await this.#placeLabels(clipboardSvc.items.map(i => i.label), undefined, boundTarget)
  }

  // Place explicit (label + sourceSegments) entries at the current location.
  // Unlike #placeLabels these are NOT top-level clipboard items — they're the
  // children surfaced when the side panel drills into a clipboard tile, so
  // there is nothing to consume. The placement primitive (#placeItems) is the
  // same: clone each source subtree to the target lineage and fold the placed
  // names into the target's children in one cascade. Nested-discard exclusions
  // inside each placed subtree are honoured there.
  async #placeEntries(entries: readonly ClipboardEntry[], targets?: Record<string, number>, boundTarget?: readonly string[]): Promise<void> {
    const lineage = this.#lineage
    const store = this.#store
    const history = this.#history
    const committer = this.#committer
    if (!lineage || !store || !history || !committer || entries.length === 0) return
    // Commits at the target; refused while rewound. Feedback, don't half-run.
    if (this.#blockedByRewound('paste')) return

    const targetSegments = boundTarget ? [...boundTarget] : [...lineage.explorerSegments()]
    EffectBus.emit('clipboard:paste-start', { count: entries.length, op: 'copy' })
    const { placed, failed } = await this.#placeItems(history, lineage, committer, entries, targetSegments, targets)
    EffectBus.emit('clipboard:paste-done', { count: placed.length, op: 'copy', failed })
  }

  // Place the named clipboard tiles at the current location. Shared by
  // `#paste` (all labels) and the side panel's per-item place
  // (`clipboard:place-items`). Mirrors paste's consume semantics: cut drops
  // the items that landed; copy keeps them for repeat placement.
  async #placeLabels(labels: readonly string[], targets?: Record<string, number>, boundTarget?: readonly string[]): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    const lineage = this.#lineage
    const store = this.#store
    const history = this.#history
    const committer = this.#committer
    if (!clipboardSvc || !lineage || !store || !history || !committer) return
    if (clipboardSvc.isEmpty || labels.length === 0) return
    // Commits at the target; refused while rewound. Feedback, don't half-run.
    if (this.#blockedByRewound('paste')) return

    const op = clipboardSvc.operation
    const wanted = new Set(labels)
    const items = clipboardSvc.items.filter(i => wanted.has(i.label))
    if (items.length === 0) return
    const targetSegments = boundTarget ? [...boundTarget] : [...lineage.explorerSegments()]

    EffectBus.emit('clipboard:paste-start', { count: items.length, op })

    // Hover-number paste targets are applied INSIDE #placeItems — folded into
    // the re-home cascade so the index lands in the same commit (a post-place
    // write raced the cascade and didn't stick).
    const { placed, failed } = await this.#placeItems(history, lineage, committer, items, targetSegments, targets)

    const placedLabels = placed.map(p => p.label)
    // Placing CONSUMES the placed items by default — copy AND cut. Otherwise the
    // clipboard would accumulate everything you ever pasted and you'd have to
    // hand-clear it (a bad experience). Only the items that actually landed are
    // dropped; failed items stay so a partial / stale paste loses nothing.
    // (A future "keep for repeat" mode can opt OUT of this for copy.)
    if (placedLabels.length > 0) {
      clipboardSvc.removeItems(new Set(placedLabels))
      if (clipboardSvc.isEmpty) {
        await clearDirectory(store.clipboard)
      } else {
        await writeMeta(store.clipboard, {
          op: clipboardSvc.operation,
          items: clipboardSvc.items.map(i => ({
            label: i.label,
            sourceSegments: [...i.sourceSegments],
          })),
        })
      }
    }

    EffectBus.emit('clipboard:paste-done', { count: placedLabels.length, op, failed })
  }

  // ── shared placement (paste + place) ──────────────────
  // For each item: skip if the target already holds a cell with that
  // name (never clobber), else clone the source cell's layer subtree to
  // the target lineage so its content is addressable at the new path.
  // Then ONE commit folds every placed label into the target's
  // `children` slot — existing children first, placed appended, full
  // list (never partial). Cloning happens BEFORE the commit so the
  // committer resolves each placed name to its freshly-homed head sig.

  async #placeItems(
    history: HistoryServiceLike,
    lineage: LineageLike,
    committer: LayerCommitterLike,
    items: readonly ClipboardEntry[],
    targetSegments: readonly string[],
    targets?: Record<string, number>,
  ): Promise<{ placed: ClipboardEntry[]; failed: string[] }> {
    // Resolve the BOUND target layer authoritatively by its segments
    // (resolveLayerAt walks the parent chain). The cursor fallback inside
    // #resolveParentLayer is gated on the bound target being the page CURRENTLY
    // on screen — so it heals a cold cache for a normal in-place paste, but can
    // never redirect a paste to wherever the view has drifted. `liveCurrent` is
    // the only live read in this method, and it's used SOLELY for that gate; the
    // target itself (`targetSegments`) was frozen at intent.
    const liveCurrent = [...lineage.explorerSegments()]
    const onScreen = this.#sameSegments(targetSegments, liveCurrent)
    const parent = await this.#resolveParentLayer(history, targetSegments, liveCurrent)

    // Refuse rather than guess: a non-root bound target that neither resolves up
    // the chain NOR is the page on screen cannot be written safely — committing
    // here would SET an empty/partial children list and wipe whatever lives at a
    // location we can't actually read. Leave the clipboard intact (nothing lost)
    // and tell the user to navigate there and place again. (Root / a genuinely
    // empty on-screen target keeps existing=[] — that's correct, not a guess.)
    if (!parent && targetSegments.length > 0 && !onScreen) {
      console.warn(`[clipboard] paste refused — bound target unresolved & off-screen at /${targetSegments.join('/')}`)
      EffectBus.emit('toast:show', {
        type: 'info',
        title: 'Paste deferred',
        message: `Couldn't resolve the paste target — navigate to /${targetSegments.join('/')} and place again.`,
      })
      return { placed: [], failed: items.map(i => i.label) }
    }

    const existing = await childNamesOf(history, parent)
    const taken = new Set(existing)

    // Participant-local nested-discard exclusions (absolute source paths). Read
    // once; each placed subtree is pruned against it below.
    const excluded = readExclusions()

    const placed: ClipboardEntry[] = []
    const failed: string[] = []
    // Re-homed subtrees, flattened into importTree updates and accumulated
    // across every placed item so the whole paste lands in ONE shared cascade.
    const treeUpdates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[] = []
    for (const entry of items) {
      if (taken.has(entry.label)) {
        console.warn(`[clipboard] target already has '${entry.label}'; skipping`)
        failed.push(entry.label)
        continue
      }
      const srcLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => [...entry.sourceSegments, entry.label],
      })
      const dstLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => [...targetSegments, entry.label],
      })

      // Self / descendant guard: never place a cell into itself or its own
      // subtree (e.g. dropping `/a/X` at `/a/X/sub`) — that would recurse the
      // re-home and duplicate the tree. Skip with a failed mark. Cut-in-place
      // (src === dst, same location) is NOT this case and is allowed.
      const srcPath = [...entry.sourceSegments, entry.label]
      const dstPath = [...targetSegments, entry.label]
      if (srcLocSig !== dstLocSig &&
          dstPath.length >= srcPath.length &&
          srcPath.every((s, i) => s === dstPath[i])) {
        console.warn(`[clipboard] skipped self/descendant paste of '${entry.label}' → /${targetSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }

      // Resolve the source cell's layer the authoritative way: through its
      // PARENT's children slot (pool-addressed sig → getLayerBySig), which
      // carries the cell's REAL subtree. resolveLayerAt walks the parent chain
      // to root, so a cell never navigated into still resolves (its own bag is
      // cold). The own-bag read (currentLayerAt(srcLocSig)) is used ONLY for the
      // cut-in-place case (src === dst: the parent already dropped the child but
      // its bag persists). For a real copy/move to a different location we
      // DELIBERATELY do not fall back to the own bag: that read can return an
      // unrelated/auto-minted seed and `flattenLayerTree` would dump a whole
      // layer's children under the pasted name ("all the tiles pasted"). A miss
      // fails the item cleanly instead.
      const srcParent = await resolveLayerAt(history, lineage.domain, entry.sourceSegments)
      const viaParent = await childLayerOf(history, srcParent, entry.label)
      const srcLayer = viaParent?.layer
        ?? (srcLocSig === dstLocSig ? await history.currentLayerAt(srcLocSig) : null)
      if (!srcLayer) {
        console.warn(`[clipboard] paste source missing for '${entry.label}': /${entry.sourceSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }
      // Name assertion: the resolved layer MUST be the cell we intend to place.
      // If resolution drifted to a parent/sibling, refuse this item rather than
      // flatten the wrong subtree in. (Layers carry their own `name`; a missing
      // name is tolerated — older bags — and falls through to placement.)
      if (typeof srcLayer.name === 'string' && srcLayer.name !== entry.label) {
        console.warn(`[clipboard] source mismatch for '${entry.label}': resolved '${srcLayer.name}'; skipping`)
        failed.push(entry.label)
        continue
      }
      // Same source and destination lineage (cut-and-paste in place) needs no
      // re-home — the content never left its bag; the parent commit below
      // name-resolves it straight back into children. Otherwise flatten the
      // source subtree into importTree updates rooted at the dest path.
      if (srcLocSig !== dstLocSig) {
        try {
          let entryUpdates = await flattenLayerTree(history, srcLayer, [...targetSegments, entry.label])
          // Honour clipboard-local nested discards (the side panel's per-item ×
          // while drilled): drop every excluded source descendant AND its whole
          // subtree from this paste, and strip its name from its parent's
          // children list. Keyed by absolute source path, so it prunes only the
          // intended branch; the source hive is never touched.
          entryUpdates = pruneExcludedUpdates(entryUpdates, targetSegments, entry.sourceSegments, excluded)
          // Hover-number paste target: rewrite the placed TOP tile's `index`
          // (its spiral slot) inside this same re-home cascade, so it lands in
          // ONE commit. Only the top node is retargeted; the subtree keeps its
          // own indexes. No target → unchanged (source index = the default).
          const target = targets?.[entry.label]
          if (typeof target === 'number' && Number.isFinite(target)) {
            const topKey = [...targetSegments, entry.label].join('/')
            const top = entryUpdates.find(u => u.segments.join('/') === topKey)
            if (top) {
              const sig = await this.#propsWithIndex(top.layer, Math.trunc(target))
              if (sig) top.layer = { ...top.layer, properties: [sig] }
            }
          }
          treeUpdates.push(...entryUpdates)
        } catch (err) {
          console.warn(`[clipboard] flatten failed for '${entry.label}':`, err)
          failed.push(entry.label)
          continue
        }
      }
      placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
      taken.add(entry.label)
    }

    if (placed.length === 0) return { placed, failed }

    EffectBus.emit('fs:changed', { segments: [...targetSegments] })

    // Eager visual mount; `viaUpdate` makes the committer's per-event
    // listener skip queueing — the update() below is the atomic commit.
    for (const entry of placed) {
      EffectBus.emit('cell:added', { cell: entry.label, segments: [...targetSegments], viaUpdate: true })
    }
    // ONE mechanical cascade: importTree commits every re-homed node plus the
    // target parent, deepest-first, with a single shared up-cascade to root —
    // the same primitive create and bulk-import use. The parent carries the
    // full new children list (existing + placed, by name) so the pasted tops
    // fold in; each subtree node carries its own children by name so the
    // hierarchy rebuilds level by level. Cut-in-place items have no treeUpdate
    // — the parent's name-resolution re-homes them from their persisted bag.
    const nextChildren = [...existing, ...placed.map(p => p.label)]

    // Seed the participant-local render index (hc:tile-props-index) for every
    // re-homed node at its NEW destination lineage. show-cell resolves a LOCAL
    // tile's image ONLY through this index (keyed by cellLocationSig) with no
    // canonical fallback — a freshly pasted tile has no entry at its new
    // location, so it renders BLANK until an unrelated reload heals it. Mirrors
    // swarm-adopt's seed for the identical flattenLayerTree/importTree re-home.
    // FILL-IF-EMPTY: never disturb an image already on a destination tile (the
    // image-stable invariant). Runs AFTER the paste-target props rewrite, so the
    // final props sig (index override included) is what lands in the index.
    try {
      const index = readTilePropsIndex()
      let seeded = false
      for (const u of treeUpdates) {
        const props = (u.layer as { properties?: unknown }).properties
        const propSig = Array.isArray(props) && typeof props[0] === 'string' ? props[0] : undefined
        if (!propSig || !/^[0-9a-f]{64}$/.test(propSig)) continue
        const segs = u.segments
        if (segs.length === 0) continue
        const key = await cellLocationSig(segs.slice(0, -1), segs[segs.length - 1])
        if (!key || index[key]) continue
        index[key] = propSig
        seeded = true
      }
      if (seeded) writeTilePropsIndex(index)
    } catch (err) {
      console.warn('[clipboard] props-index seed skipped', err)
    }

    await committer.importTree([
      { segments: [...targetSegments], layer: { ...(parent ?? {}), children: nextChildren } },
      ...treeUpdates,
    ])
    await new hypercomb().act()

    // No forced full re-render here. `place` (the "add to current" path)
    // exits the clipboard view AFTER this returns, and that exit render runs
    // a same-layer rebuild against the now-committed layer — it shows the
    // final set (existing + placed) in one clean, mesh-hidden-then-revealed
    // paint. A post-commit fs:changed would instead clear and rebuild the
    // already-visible mesh, re-introducing the "resize / disappear / re-render"
    // flash and an extra full pass. The eager cell:added above keeps the
    // incremental path covering the paste button's exit-before-commit order.

    return { placed, failed }
  }

  // Build a new props resource = the tile's existing properties with `index`
  // overridden, content-addressed the SAME way writeTilePropertiesAt does
  // (sorted keys → JSON) so the sig is consistent. Used by the paste-target
  // override to set a placed tile's spiral slot inside the re-home cascade.
  async #propsWithIndex(layer: unknown, index: number): Promise<string | null> {
    const store = this.#store
    if (!store?.putResource) return null
    const slot = (layer as { properties?: readonly unknown[] } | null | undefined)?.properties
    const existingSig = Array.isArray(slot) && slot.length > 0 ? slot[0] : undefined
    let props: Record<string, unknown> = {}
    if (typeof existingSig === 'string' && store.getResource) {
      try {
        const blob = await store.getResource(existingSig)
        if (blob) { const parsed = JSON.parse(await blob.text()); if (parsed && typeof parsed === 'object') props = parsed }
      } catch { /* fresh props */ }
    }
    const merged: Record<string, unknown> = { ...props, index }
    const canonical: Record<string, unknown> = {}
    for (const k of Object.keys(merged).sort()) canonical[k] = merged[k]
    try {
      return await store.putResource(new Blob([JSON.stringify(canonical)], { type: 'application/json' }))
    } catch { return null }
  }

  // ── clear ─────────────────────────────────────────────

  async #clearClipboard(): Promise<void> {
    this.#clipboardSvc?.clear()
    clearExclusions()
    const store = this.#store
    if (store) await clearDirectory(store.clipboard)
  }

  // ── validate ──────────────────────────────────────────
  // Drop entries that are DEFINITIVELY gone, so the clipboard count never
  // shows a tile that no longer exists. Called from restore and from the
  // controls-bar toggleClipboard before opening the panel.
  //
  // CONSERVATIVE BY DESIGN: viewing the clipboard must never lose data.
  // Membership is resolved the authoritative way — through the source
  // PARENT's children slot (childLayerOf), the same path the renderer and
  // paste use. The previous check used currentLayerAt(sign(source+label)),
  // i.e. the CELL'S OWN bag, which is empty for any cell never navigated
  // into — so it false-flagged live tiles as ghosts, validate removed
  // them, and toggleClipboard then bailed on the now-empty clipboard
  // ("click clipboard → tile disappears, lost"). An entry is dropped ONLY
  // when its parent layer loaded AND the cell is absent from it (and the
  // own-bag fallback also misses). A cold/unresolvable parent is treated
  // as "uncertain → keep", never as "gone".

  async validate(): Promise<void> {
    const svc = this.#clipboardSvc
    const store = this.#store
    const lineage = this.#lineage
    if (!svc || !store || svc.isEmpty) return

    const history = this.#history
    if (!lineage || !history) return

    const items = svc.items
    const invalid = new Set<string>()
    for (const entry of items) {
      const parentSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => [...entry.sourceSegments],
      })
      const parent = await history.currentLayerAt(parentSig)
      // Parent didn't resolve — could just be a cold bag (user navigated
      // away since copying). Uncertain, so KEEP the entry; never drop on a
      // miss we can't trust.
      if (!parent) continue
      // Parent loaded: authoritative. Present in its children → valid.
      if (await childLayerOf(history, parent, entry.label)) continue
      // Absent from a loaded parent. Last chance: the cell's own bag (the
      // cut-in-place case keeps the bag even after the parent drops it).
      const ownSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => [...entry.sourceSegments, entry.label],
      })
      if (await history.currentLayerAt(ownSig)) continue
      invalid.add(entry.label)
    }

    if (invalid.size === 0) return

    svc.removeItems(invalid)

    if (svc.isEmpty) {
      await clearDirectory(store.clipboard)
    } else {
      await writeMeta(store.clipboard, {
        op: svc.operation,
        items: svc.items.map(i => ({
          label: i.label,
          sourceSegments: [...i.sourceSegments],
        })),
      })
    }
  }

  // ── hierarchy: child count at a location ──────────────
  // How many children the cell at `segments` (= [...sourceSegments, label])
  // has — for the side panel's per-item count badge + the drill-down. Resolved
  // via the PARENT's children slot (childLayerOf), the warm/authoritative path
  // validate() uses, NOT the cell's own bag (cold for any cell never navigated
  // into — that read is what once hung a 30-item clipboard). Best-effort: any
  // miss returns 0. Callers MUST keep this off the render path (capped, async).
  async childCountAt(segments: readonly string[]): Promise<number> {
    const history = this.#history
    if (!history || segments.length === 0) return 0
    const parent = await resolveLayerAt(history, this.#lineage?.domain, segments.slice(0, -1))
    const found = await childLayerOf(history, parent, segments[segments.length - 1])
    const children = found?.layer?.children
    return Array.isArray(children) ? children.length : 0
  }

  // The child NAMES at a location — for the drill-down. Clicking a clipboard
  // tile's hex shows ITS children (segments = [...sourceSegments, label]); each
  // child's own segments are [...segments, name]. resolveLayerAt resolves the
  // drilled tile via the warm parent-slot fallback; childNamesOf reads only
  // that tile's child sigs. Best-effort: a miss returns []. One drill at a
  // time — never call this for every item eagerly.
  async childrenAt(segments: readonly string[]): Promise<string[]> {
    const history = this.#history
    if (!history) return []
    const layer = await resolveLayerAt(history, this.#lineage?.domain, segments)
    return childNamesOf(history, layer)
  }

  // Canonical props-resource sig for the cell at `segments` — `properties[0]`
  // in the cell's head layer (see editor/tile-properties.ts). The side panel
  // falls back to this when the participant-local render-index has NO entry —
  // a cut tile, or a generated image on a tile that was never re-rendered — so
  // the clipboard thumbnail shows WITHOUT needing a render, and never loses a
  // generated image. Resolution mirrors validate(): the warm PARENT-slot path
  // first (copy tiles, where the parent still lists the cell), then the cell's
  // OWN bag (cut tiles — the cut leaves a non-empty bag in place, so this is
  // NOT the cold empty-bag read that triggers preloadAllBags). Best-effort.
  async propsSigAt(segments: readonly string[]): Promise<string | null> {
    const history = this.#history
    const lineage = this.#lineage
    if (!history || segments.length === 0) return null
    const label = segments[segments.length - 1]
    const parent = await resolveLayerAt(history, lineage?.domain, segments.slice(0, -1))
    let layer: unknown = (await childLayerOf(history, parent, label))?.layer ?? null
    if (!layer) {
      const ownSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => segments })
      layer = await history.currentLayerAt(ownSig)
    }
    const slot = (layer as { properties?: readonly unknown[] } | null | undefined)?.properties
    const sig = Array.isArray(slot) && slot.length > 0 ? slot[0] : undefined
    return (typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig)) ? sig : null
  }

  // The cell's current `index` (its spiral/pinned-layout slot) — the side
  // panel's DEFAULT paste target. Read from the canonical props (propsSigAt →
  // resource → `index`). Null when there are no properties / no index yet.
  async indexAt(segments: readonly string[]): Promise<number | null> {
    const propsSig = await this.propsSigAt(segments)
    if (!propsSig) return null
    const blob = await this.#store?.getResource?.(propsSig)
    if (!blob) return null
    try {
      const props = JSON.parse(await blob.text()) as { index?: unknown }
      return typeof props.index === 'number' && Number.isFinite(props.index) ? props.index : null
    } catch { return null }
  }

  // ── discard (drop without placing) ────────────────────
  // Remove the named entries from the clipboard and re-persist, so the panel's
  // per-item "×" drops a pointer for good. Same persistence shape as validate.
  async #discardLabels(labels: readonly string[]): Promise<void> {
    const svc = this.#clipboardSvc
    if (!svc) return
    svc.removeItems(new Set(labels))
    const store = this.#store
    if (!store) return
    if (svc.isEmpty) {
      await clearDirectory(store.clipboard)
    } else {
      await writeMeta(store.clipboard, {
        op: svc.operation,
        items: svc.items.map(i => ({ label: i.label, sourceSegments: [...i.sourceSegments] })),
      })
    }
  }

  // ── restore from OPFS on startup ──────────────────────
  // Cut folders that were moved into store.clipboard before refresh
  // are still there; the meta file tells us which labels and op.

  async #restoreFromOpfs(): Promise<void> {
    const store = this.#store
    const clipboardSvc = this.#clipboardSvc
    if (!store || !clipboardSvc) return
    if (!clipboardSvc.isEmpty) return

    const meta = await readMeta(store.clipboard)
    if (!meta || meta.items.length === 0) return

    clipboardSvc.capture(
      meta.items.map(i => i.label),
      meta.items[0]?.sourceSegments ?? [],
      meta.op,
    )

    await this.validate()
  }
}

// ── meta persistence ──────────────────────────────────────

interface ClipboardMeta {
  op: ClipboardOp
  items: { label: string; sourceSegments: string[] }[]
}

const META_TMP = '__meta__.tmp'

// Two-phase write: serialise into __meta__.tmp first, verify it parses, then
// swap into __meta__. If the process dies mid-write, the old __meta__ is
// untouched. readMeta() prefers a valid __meta__.tmp over __meta__ so a
// half-swapped state can still be recovered.
async function writeMeta(
  clipDir: FileSystemDirectoryHandle,
  meta: ClipboardMeta,
): Promise<void> {
  const json = JSON.stringify(meta)
  try {
    const tmp = await clipDir.getFileHandle(META_TMP, { create: true })
    const w = await tmp.createWritable()
    try {
      await w.write(json)
    } finally {
      await w.close()
    }
    // verify the temp can be parsed before swapping
    try {
      const file = await tmp.getFile()
      JSON.parse(await file.text())
    } catch {
      await clipDir.removeEntry(META_TMP).catch(() => { /* ignore */ })
      return
    }
    const handle = await clipDir.getFileHandle(META_FILE, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(json)
    } finally {
      await writable.close()
    }
    await clipDir.removeEntry(META_TMP).catch(() => { /* ignore */ })
  } catch (err) {
    console.warn('[clipboard] writeMeta failed:', err)
  }
}

async function readMeta(
  clipDir: FileSystemDirectoryHandle,
): Promise<ClipboardMeta | null> {
  const tryParse = async (name: string): Promise<ClipboardMeta | null> => {
    try {
      const handle = await clipDir.getFileHandle(name, { create: false })
      const file = await handle.getFile()
      const text = await file.text()
      return JSON.parse(text) as ClipboardMeta
    } catch {
      return null
    }
  }
  // Prefer the committed __meta__; fall back to the in-flight __meta__.tmp
  // if the committed copy is missing or unreadable.
  return (await tryParse(META_FILE)) ?? (await tryParse(META_TMP))
}

async function clearDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
  const entries: string[] = []
  for await (const [name] of (dir as any).entries()) {
    entries.push(name)
  }
  for (const name of entries) {
    try {
      await dir.removeEntry(name, { recursive: true })
    } catch { /* ignore */ }
  }
}

// ── nested-discard exclusions ─────────────────────────────
// When the side panel drills into a clipboard tile and discards one of its
// CHILDREN, that child isn't a top-level clipboard entry — it's a live pointer
// into the source tree. We can't drop it from the clipboard list and we must
// never edit the source hive (clipboard is participant-local). So the panel
// records the child's ABSOLUTE source path here and paste honours it by pruning
// that branch. localStorage (not OPFS) because both the panel (shared shell) and
// this worker (essentials) read/write it directly, same as hc:tile-props-index.

const EXCLUSIONS_KEY = 'hc:clipboard-exclusions'

function readExclusions(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(EXCLUSIONS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

function clearExclusions(): void {
  try { localStorage.removeItem(EXCLUSIONS_KEY) } catch { /* ignore */ }
}

// Prune a flattened source subtree (importTree updates rooted at
// `[...targetSegments, entry.label]`) of every node whose ABSOLUTE source path
// is excluded — and of that node's whole subtree — then strip the excluded leaf
// names from their surviving parent's children list. `sourceBase` is the placed
// entry's sourceSegments; a flattened node at dest `segments` maps back to the
// source path `[...sourceBase, ...segments.slice(targetSegments.length)]`.
function pruneExcludedUpdates(
  updates: { segments: string[]; layer: { name?: string; [slot: string]: unknown } }[],
  targetSegments: readonly string[],
  sourceBase: readonly string[],
  excluded: ReadonlySet<string>,
): typeof updates {
  if (excluded.size === 0) return updates
  const tlen = targetSegments.length
  const srcPathOf = (segs: readonly string[]): string =>
    [...sourceBase, ...segs.slice(tlen)].join('/')

  // Dest-segment keys of nodes whose source path is excluded.
  const excludedKeys: string[] = []
  for (const u of updates) {
    if (excluded.has(srcPathOf(u.segments))) excludedKeys.push(u.segments.join('/'))
  }
  if (excludedKeys.length === 0) return updates

  const underExcluded = (key: string): boolean =>
    excludedKeys.some(p => key === p || key.startsWith(p + '/'))

  // Excluded leaf name → its parent dest-key, so survivors can drop it.
  const namesByParent = new Map<string, Set<string>>()
  for (const key of excludedKeys) {
    const segs = key.split('/')
    const name = segs[segs.length - 1]
    const parentKey = segs.slice(0, -1).join('/')
    const set = namesByParent.get(parentKey) ?? new Set<string>()
    set.add(name)
    namesByParent.set(parentKey, set)
  }

  return updates
    .filter(u => !underExcluded(u.segments.join('/')))
    .map(u => {
      const drop = namesByParent.get(u.segments.join('/'))
      if (!drop) return u
      const children = u.layer['children']
      if (!Array.isArray(children)) return u
      return { segments: u.segments, layer: { ...u.layer, children: children.filter((c: unknown) => !drop.has(String(c))) } }
    })
}

const _clipboard = new ClipboardWorker()
window.ioc.register('@diamondcoreprocessor.com/ClipboardWorker', _clipboard)
