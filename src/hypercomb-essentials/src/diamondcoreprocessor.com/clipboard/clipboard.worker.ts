// diamondcoreprocessor.com/core/clipboard/clipboard.worker.ts
import { Worker, EffectBus, hypercomb } from '@hypercomb/core'
import type { ClipboardService, ClipboardOp } from './clipboard.service.js'
import { childNamesOf, childEntriesOf, childLayerOf, resolveLayerAt, captureCollectionSig } from '../history/layer-placement.js'
import { readTilePropsIndex, writeTilePropsIndex, cellLocationSig } from '../editor/tile-properties.js'

interface ClipboardEntry {
  label: string
  sourceSegments: readonly string[]
  /** The COLLECTION sig, captured at cut/copy intent: a merkle fold of
   *  the cell's live subtree (sealSubtree), falling back to the parent's
   *  stored child sig. One sig carries the whole subtree — paste appends
   *  it to the destination's children and nothing else. History is
   *  append-only, so it resolves at any destination, forever. */
  sig?: string
}

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
  childrenManifestFor?(layer: LayerLike): Promise<Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }> | null>
  /** Merkle fold of a subtree's live heads into one pool-written root sig
   *  — the collection-capture primitive (see captureCollectionSig). */
  sealSubtree?(segments: readonly string[]): Promise<string | null>
  /** Pool-write a derived layer (canonicalize → sign → write, NO marker)
   *  — the re-mint primitive for index overrides and exclusion pruning. */
  materializeLayer?(layer: { name?: string; [k: string]: unknown }): Promise<string>
}

interface LayerCommitterLike {
  commitChildrenDeltas(
    segments: readonly string[],
    changes: { removes?: readonly { sig?: string; label?: string }[]; appends?: readonly string[] },
  ): Promise<void>
}

interface StoreLike {
  readonly clipboard: FileSystemDirectoryHandle
  getResource?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob) => Promise<string>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
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

      // Cut = detach each leaf from its source parent's `children` slot —
      // surgical sig-space removes, ONE commit per affected parent.
      // Nothing is deleted: the leaf's bytes, markers and bag all
      // survive; the parent's new head simply stops listing it (undo
      // restores it forever). Labels may be `/`-separated paths — group
      // leaves by their parent.
      const groups = new Map<string, { parentSegs: string[]; leaves: Set<string> }>()
      const moved: ClipboardEntry[] = []
      const movedByKey = new Map<string, ClipboardEntry>()
      for (const label of labels) {
        const pathSegs = label.split('/').filter(Boolean)
        if (pathSegs.length === 0) continue
        const leaf = pathSegs[pathSegs.length - 1]
        const parentSegs = [...baseSegments, ...pathSegs.slice(0, -1)]
        const key = parentSegs.join('/')
        const group = groups.get(key) ?? { parentSegs, leaves: new Set<string>() }
        group.leaves.add(leaf)
        groups.set(key, group)
        const entry: ClipboardEntry = { label: leaf, sourceSegments: parentSegs }
        moved.push(entry)
        movedByKey.set(`${key}/${leaf}`, entry)
      }
      if (moved.length === 0) return

      this.#clipboardSvc?.captureEntries(moved, 'cut')

      EffectBus.emit('fs:changed', { segments: [...baseSegments] })

      for (const { parentSegs, leaves } of groups.values()) {
        // Resolve the parent for the name→sig map only — the commit below
        // is delta-shaped and hydrates from the bag head itself.
        const parent = await this.#resolveParentLayer(history, parentSegs, baseSegments)
        if (!parent) {
          console.warn(`[clipboard] cut skipped — parent layer unresolved at /${parentSegs.join('/')}`)
          continue
        }
        // name → stored child sig, manifest-first: one pool read covers
        // the whole parent.
        const { entries } = await childEntriesOf(history, parent)
        const sigByName = new Map(entries.map(e => [e.name, e.sig]))

        // Capture each leaf's COLLECTION sig at intent: sealSubtree folds
        // the subtree's live heads into one merkle root (the same
        // primitive sharing uses — cut/copy is sharing with yourself);
        // the parent's stored child sig is the fallback. History is
        // append-only, so the captured sig resolves at ANY destination,
        // forever — including after this commit drops the child.
        const removes: { sig?: string; label?: string }[] = []
        for (const leaf of leaves) {
          const entry = movedByKey.get(`${parentSegs.join('/')}/${leaf}`)
          const stored = sigByName.get(leaf)
          const captured = await captureCollectionSig(history, [...parentSegs, leaf], stored)
          if (entry && captured) entry.sig = captured
          removes.push({ ...(stored ? { sig: stored } : {}), label: leaf })
        }

        // Eager visual unmount; `viaUpdate` tells the committer's per-
        // event listener to skip queueing — the delta commit below IS the
        // atomic commit for this action.
        for (const leaf of leaves) {
          EffectBus.emit('cell:removed', { cell: leaf, segments: [...parentSegs], viaUpdate: true })
        }
        // ONE surgical commit: children minus the cut sigs. No name
        // re-listing, so a cold sibling can't be wiped — the old strict
        // survivors read and its "cut skipped — cold sibling" refusals
        // are structurally unnecessary now.
        await committer.commitChildrenDeltas(parentSegs, { removes })
      }

      // Re-capture with the sigs resolved above — the early capture (pre-
      // commit, for immediate UI) copied entries before enrichment.
      this.#clipboardSvc?.captureEntries(moved, 'cut')

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
    // Capture each entry's COLLECTION sig at intent — seal-first (live
    // merkle fold), the parent's stored child sig as fallback. One
    // manifest-first childEntriesOf read per distinct source parent. The
    // copy source stays in place, so a failed capture just means paste
    // re-captures from the path later.
    const history = this.#history
    if (history) {
      const sigsByParent = new Map<string, Map<string, string>>()
      for (const entry of copyEntries) {
        try {
          const key = entry.sourceSegments.join('/')
          let byName = sigsByParent.get(key)
          if (!byName) {
            const srcParent = await resolveLayerAt(history, lineage?.domain, entry.sourceSegments)
            const { entries } = await childEntriesOf(history, srcParent)
            byName = new Map(entries.map(e => [e.name, e.sig]))
            sigsByParent.set(key, byName)
          }
          const captured = await captureCollectionSig(
            history, [...entry.sourceSegments, entry.label], byName.get(entry.label))
          if (captured) entry.sig = captured
        } catch { /* path fallback at paste */ }
      }
    }
    this.#clipboardSvc?.captureEntries(copyEntries, 'copy')
    EffectBus.emit('clipboard:captured', { labels: copyEntries.map(e => e.label), op: 'copy' })
    void this.#persistMetaEntries('copy', copyEntries)
  }

  async #persistMetaEntries(op: ClipboardOp, entries: readonly ClipboardEntry[]): Promise<void> {
    const store = this.#store
    if (!store) return
    await writeMeta(store, {
      op,
      items: entries.map(e => ({ label: e.label, sourceSegments: [...e.sourceSegments], ...(e.sig ? { sig: e.sig } : {}) })),
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
        await writeMeta(store, {
          op: clipboardSvc.operation,
          items: clipboardSvc.items.map(i => ({
            label: i.label,
            sourceSegments: [...i.sourceSegments],
            ...(i.sig ? { sig: i.sig } : {}),
          })),
        })
      }
    }

    EffectBus.emit('clipboard:paste-done', { count: placedLabels.length, op, failed })
  }

  // ── shared placement (paste + place) ──────────────────
  // Sig-native: each item resolves to ONE collection sig (captured at
  // cut/copy intent, or sealed at place time), and the whole paste is
  // ONE surgical commit appending those sigs to the target's `children`.
  // The subtree is never re-committed — its bytes are pool-addressed and
  // position-independent, and navigation into it resolves lazily through
  // the parent chain (HistoryService seeds the bag on first visit/edit).

  async #placeItems(
    history: HistoryServiceLike,
    lineage: LineageLike,
    committer: LayerCommitterLike,
    items: readonly ClipboardEntry[],
    targetSegments: readonly string[],
    targets?: Record<string, number>,
  ): Promise<{ placed: ClipboardEntry[]; failed: string[] }> {
    // Phase stopwatch — one summary line per paste (repo perf-log style).
    const tStart = performance.now()
    let tParent = 0, tCapture = 0, tPrep = 0, tSeed = 0, tCommit = 0

    // Resolve the BOUND target layer for the collision check only — the
    // commit below is delta-shaped (append), hydrates from the bag head
    // itself, and never re-lists children, so a cold/unresolved target no
    // longer risks wiping anything. The cursor fallback inside
    // #resolveParentLayer is gated on the bound target being the page
    // currently on screen; the target itself was frozen at intent.
    const liveCurrent = [...lineage.explorerSegments()]
    const parent = await this.#resolveParentLayer(history, targetSegments, liveCurrent)
    // Collision names: manifest-first, tolerant. An append can't wipe a
    // cold sibling, so the strict-read refusals ("paste deferred — cold
    // sibling") are structurally unnecessary; a cold miss at worst lets a
    // duplicate name through, and the head is the final word on membership.
    const { entries: existingEntries } = await childEntriesOf(history, parent)
    tParent = performance.now() - tStart
    const taken = new Set(existingEntries.map(e => e.name))

    // Participant-local nested-discard exclusions (absolute source paths).
    const excluded = readExclusions()

    const placed: ClipboardEntry[] = []
    const appends: string[] = []
    const failed: string[] = []
    for (const entry of items) {
      if (taken.has(entry.label)) {
        console.warn(`[clipboard] target already has '${entry.label}'; skipping`)
        failed.push(entry.label)
        continue
      }
      // Self / descendant guard: never place a cell into its own subtree
      // (e.g. dropping `/a/X` at `/a/X/sub`) — pure path check; location
      // sigs are path-derived so equal paths ⇔ equal locations. Paste
      // back in place (identical paths) is allowed.
      const srcPath = [...entry.sourceSegments, entry.label]
      const dstPath = [...targetSegments, entry.label]
      const samePlace = srcPath.length === dstPath.length && srcPath.every((s, i) => s === dstPath[i])
      if (!samePlace &&
          dstPath.length >= srcPath.length &&
          srcPath.every((s, i) => s === dstPath[i])) {
        console.warn(`[clipboard] skipped self/descendant paste of '${entry.label}' → /${targetSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }

      const tCap0 = performance.now()
      // The collection sig: captured at cut/copy intent. Sig-less entries
      // (side-panel drilled children, legacy restores) seal at place time
      // — same primitive, applied late; the source parent's stored child
      // sig backs it up inside captureCollectionSig.
      let sig = entry.sig ?? null
      if (!sig) sig = await captureCollectionSig(history, srcPath)
      let layer = sig ? await history.getLayerBySig(sig) : null
      tCapture += performance.now() - tCap0
      if (!sig || !layer) {
        console.warn(`[clipboard] paste source missing for '${entry.label}': /${entry.sourceSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }
      // Name assertion: the sig MUST name the cell we intend to place —
      // if capture drifted to a parent/sibling, refuse this item rather
      // than link the wrong subtree in.
      if (typeof layer.name === 'string' && layer.name !== entry.label) {
        console.warn(`[clipboard] source mismatch for '${entry.label}': resolved '${layer.name}'; skipping`)
        failed.push(entry.label)
        continue
      }

      const tPrep0 = performance.now()
      // Nested discards (the side panel's per-item × while drilled): the
      // pruned collection is a DERIVED layer — re-mint the spine down to
      // each excluded branch (pool writes only, no markers, no commits).
      if (excluded.size > 0) {
        const pruned = await this.#pruneCollection(history, sig, layer, srcPath, excluded)
        sig = pruned.sig
        layer = pruned.layer
      }
      // Hover-number paste target: fold the index override into the TOP
      // node's props and re-mint that one node. The subtree under it is
      // untouched (its sigs ride along inside the re-minted layer).
      const target = targets?.[entry.label]
      if (typeof target === 'number' && Number.isFinite(target) && typeof history.materializeLayer === 'function') {
        const propsSig = await this.#propsWithIndex(layer, Math.trunc(target))
        if (propsSig) {
          const reminted = { ...layer, properties: [propsSig] }
          sig = await history.materializeLayer(reminted)
          layer = reminted
        }
      }
      tPrep += performance.now() - tPrep0

      appends.push(sig)
      placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
      taken.add(entry.label)
    }

    if (placed.length === 0) return { placed, failed }

    EffectBus.emit('fs:changed', { segments: [...targetSegments] })

    // Eager visual mount; `viaUpdate` makes the committer's per-event
    // listener skip queueing — the delta commit below is the atomic commit.
    for (const entry of placed) {
      EffectBus.emit('cell:added', { cell: entry.label, segments: [...targetSegments], viaUpdate: true })
    }

    // Seed the participant-local render index (hc:tile-props-index) at the
    // DESTINATION keys for the whole pasted subtree — a pure sig-walk over
    // warm pool bytes, no commits. show-cell resolves a LOCAL tile's image
    // ONLY through this index (keyed by cellLocationSig); overwrite, not
    // fill-if-empty — paste refuses name collisions, so any existing entry
    // at a destination key is stale.
    const tSeed0 = performance.now()
    try {
      await this.#seedPropsIndex(history, appends, targetSegments)
    } catch (err) {
      console.warn('[clipboard] props-index seed skipped', err)
    }
    tSeed = performance.now() - tSeed0

    // ONE surgical commit: the target's children gain the collection sigs.
    // Existing children (warm or cold) ride through verbatim.
    const tCommit0 = performance.now()
    await committer.commitChildrenDeltas(targetSegments, { appends })
    tCommit = performance.now() - tCommit0
    console.log(
      `[clipboard] paste: total=${Math.round(performance.now() - tStart)}ms ` +
      `parent=${Math.round(tParent)}ms capture=${Math.round(tCapture)}ms prep=${Math.round(tPrep)}ms ` +
      `seed=${Math.round(tSeed)}ms commit=${Math.round(tCommit)}ms ` +
      `(${placed.length} placed, ${existingEntries.length} existing children)`
    )
    await new hypercomb().act()

    // No forced full re-render here — the eager cell:added above covers the
    // incremental path, and the clipboard-exit render rebuilds against the
    // committed layer (see the paste button's exit-before-commit ordering).

    return { placed, failed }
  }

  // Walk a placed collection (pool-warm, sig-addressed) and seed the
  // participant-local render index at each node's DESTINATION location key.
  // Read-only over layers; one localStorage write at the end.
  async #seedPropsIndex(
    history: HistoryServiceLike,
    rootSigs: readonly string[],
    targetSegments: readonly string[],
  ): Promise<void> {
    const index = readTilePropsIndex()
    let seeded = false
    const seen = new Set<string>()
    const queue: { sig: string; parentSegs: string[] }[] =
      rootSigs.map(sig => ({ sig, parentSegs: [...targetSegments] }))
    while (queue.length > 0) {
      const { sig, parentSegs } = queue.shift()!
      const layer = await history.getLayerBySig(sig)
      const name = typeof layer?.name === 'string' ? layer.name : ''
      // Unsafe names (path separators / control chars) would address a
      // different location — skip the node and its subtree, mirroring
      // flattenLayerTree's guard.
      if (!layer || !name || /[\\/\x00-\x1f]/.test(name)) continue
      const dedupeKey = `${sig}|${parentSegs.join('/')}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      const props = (layer as { properties?: unknown }).properties
      const propSig = Array.isArray(props) && typeof props[0] === 'string' ? props[0] : undefined
      if (propSig && /^[0-9a-f]{64}$/.test(propSig)) {
        const key = await cellLocationSig(parentSegs, name)
        if (key && index[key] !== propSig) {
          index[key] = propSig
          seeded = true
        }
      }
      const children = Array.isArray(layer.children) ? layer.children : []
      for (const c of children) queue.push({ sig: String(c), parentSegs: [...parentSegs, name] })
    }
    if (seeded) writeTilePropsIndex(index)
  }

  // Re-mint a collection minus its excluded branches — the sig-native
  // replacement for pruning flattened updates. Exclusions are ABSOLUTE
  // source paths (see readExclusions); only spines leading to an excluded
  // branch are re-signed (pool writes via materializeLayer, no markers).
  async #pruneCollection(
    history: HistoryServiceLike,
    sig: string,
    layer: LayerLike,
    srcPath: readonly string[],
    excluded: ReadonlySet<string>,
  ): Promise<{ sig: string; layer: LayerLike }> {
    if (typeof history.materializeLayer !== 'function') return { sig, layer }
    const anyUnder = (path: readonly string[]): boolean => {
      const key = path.join('/')
      for (const x of excluded) {
        if (x === key || x.startsWith(key + '/')) return true
      }
      return false
    }
    const prune = async (
      nodeSig: string,
      node: LayerLike,
      path: readonly string[],
    ): Promise<{ sig: string; layer: LayerLike } | null> => {
      if (excluded.has(path.join('/'))) return null
      if (!anyUnder(path)) return { sig: nodeSig, layer: node }
      const childSigs = Array.isArray(node.children) ? node.children.map(String) : []
      let changed = false
      const kept: string[] = []
      for (const cs of childSigs) {
        const child = await history.getLayerBySig(cs)
        const name = typeof child?.name === 'string' ? child.name : ''
        if (!child || !name) { kept.push(cs); continue }
        const result = await prune(cs, child, [...path, name])
        if (result === null) { changed = true; continue }
        kept.push(result.sig)
        if (result.sig !== cs) changed = true
      }
      if (!changed) return { sig: nodeSig, layer: node }
      const next: LayerLike = { ...node, children: kept }
      if (kept.length === 0) delete (next as Record<string, unknown>)['children']
      const nextSig = await history.materializeLayer!(next)
      return { sig: nextSig, layer: next }
    }
    return await prune(sig, layer, srcPath) ?? { sig, layer }
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
        if (!blob) return null // props exist but are COLD — a rewrite would STRIP the image; keep the original slot
        const parsed = JSON.parse(await blob.text())
        if (parsed && typeof parsed === 'object') props = parsed
      } catch { return null } // unreadable props — never mint a stripped replacement
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
      // Sig-first: the collection sig captured at intent resolves at any
      // destination regardless of what happened to the source path since
      // — bytes present ⇒ pasteable ⇒ valid. Only sig-less legacy entries
      // fall through to path resolution.
      if (entry.sig && await history.getLayerBySig(entry.sig)) continue
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
      await writeMeta(store, {
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
      await writeMeta(store, {
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

    const meta = await readMeta(store)
    if (!meta || meta.items.length === 0) return

    // Per-entry restore — keeps each item's own sourceSegments AND its
    // captured source sig, so a restored cut still pastes anywhere.
    clipboardSvc.captureEntries(meta.items, meta.op)

    await this.validate()
  }
}

// ── meta persistence ──────────────────────────────────────
//
// The clipboard record is a content-addressed DOCUMENT in the
// sign('clipboard') pool — putPoolDoc under the sign('clipboard-meta')
// sub-bucket. The current record is the bucket's single sig-named
// member: no fixed filename, identical content dedupes, and the new
// member is fully written BEFORE the old one drops, giving the same
// crash-safety the old `__meta__.tmp` two-phase swap provided. The
// legacy fixed-name `__meta__` / `__meta__.tmp` files are READ-fallback
// drains, removed after the first pool-doc write.

interface ClipboardMeta {
  op: ClipboardOp
  items: { label: string; sourceSegments: string[]; sig?: string }[]
}

const META_SUBKEY = 'clipboard-meta'
const LEGACY_META = '__meta__'
const LEGACY_META_TMP = '__meta__.tmp'

async function writeMeta(
  store: StoreLike,
  meta: ClipboardMeta,
): Promise<void> {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(meta))
    const sig = await store.putPoolDoc?.(store.clipboard, bytes.buffer as ArrayBuffer, META_SUBKEY)
    if (!sig) {
      console.warn('[clipboard] writeMeta failed — pool doc unavailable')
      return
    }
    // Pool doc is authoritative now — drain the legacy fixed-name files.
    await store.clipboard.removeEntry(LEGACY_META).catch(() => { /* absent */ })
    await store.clipboard.removeEntry(LEGACY_META_TMP).catch(() => { /* absent */ })
  } catch (err) {
    console.warn('[clipboard] writeMeta failed:', err)
  }
}

async function readMeta(
  store: StoreLike,
): Promise<ClipboardMeta | null> {
  try {
    const bytes = await store.getPoolDoc?.(store.clipboard, META_SUBKEY)
    if (bytes) return JSON.parse(new TextDecoder().decode(bytes)) as ClipboardMeta
  } catch { /* malformed doc — fall through to legacy */ }
  // Legacy drain read: pre-pool-doc sessions left `__meta__` (and possibly
  // an in-flight `__meta__.tmp`) at the pool root.
  const tryParse = async (name: string): Promise<ClipboardMeta | null> => {
    try {
      const handle = await store.clipboard.getFileHandle(name, { create: false })
      const file = await handle.getFile()
      return JSON.parse(await file.text()) as ClipboardMeta
    } catch {
      return null
    }
  }
  return (await tryParse(LEGACY_META)) ?? (await tryParse(LEGACY_META_TMP))
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

const _clipboard = new ClipboardWorker()
window.ioc.register('@diamondcoreprocessor.com/ClipboardWorker', _clipboard)
