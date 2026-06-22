// diamondcoreprocessor.com/core/clipboard/clipboard.worker.ts
import { Worker, EffectBus, hypercomb } from '@hypercomb/core'
import type { ClipboardService, ClipboardOp } from './clipboard.service.js'
import { childNamesOf, childLayerOf, resolveLayerAt, flattenLayerTree } from '../history/layer-placement.js'

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

    EffectBus.on<{ action: string }>('controls:action', (payload) => {
      if (!payload?.action) return
      switch (payload.action) {
        case 'copy': void this.#capture('copy'); break
        case 'cut': void this.#capture('cut'); break
        case 'paste': void this.#paste(); break
        case 'clear-clipboard': void this.#clearClipboard(); break
      }
    })

    EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (!payload?.cmd) return
      switch (payload.cmd) {
        case 'clipboard.copy': void this.#capture('copy'); break
        case 'layout.cutCells': void this.#capture('cut'); break
        case 'clipboard.paste': void this.#paste(); break
      }
    })

    // Place specific clipboard tiles at the current location — the
    // non-navigating side panel's per-item "place" button. Same placement
    // primitive as paste, scoped to the requested labels.
    EffectBus.on<{ labels?: string[] }>('clipboard:place-items', (payload) => {
      const labels = Array.isArray(payload?.labels) ? payload!.labels! : []
      if (labels.length > 0) void this.#placeLabels(labels)
    })


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

  async #paste(): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    if (!clipboardSvc || clipboardSvc.isEmpty) return
    // Paste = place EVERY clipboard tile at the current location.
    await this.#placeLabels(clipboardSvc.items.map(i => i.label))
  }

  // Place the named clipboard tiles at the current location. Shared by
  // `#paste` (all labels) and the side panel's per-item place
  // (`clipboard:place-items`). Mirrors paste's consume semantics: cut drops
  // the items that landed; copy keeps them for repeat placement.
  async #placeLabels(labels: readonly string[]): Promise<void> {
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
    const targetSegments = [...lineage.explorerSegments()]

    EffectBus.emit('clipboard:paste-start', { count: items.length, op })

    const { placed, failed } = await this.#placeItems(history, lineage, committer, items, targetSegments)

    const placedLabels = placed.map(p => p.label)
    // cut: drop only the items that actually landed. Failed items stay on
    // the clipboard so a partial / stale paste doesn't lose data.
    // copy: leave the clipboard intact for repeat paste.
    if (op === 'cut' && placedLabels.length > 0) {
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
  ): Promise<{ placed: ClipboardEntry[]; failed: string[] }> {
    // Resolve the target layer ROBUSTLY (own-bag read is empty for a never-
    // committed sub-layer; resolveLayerAt walks the parent chain, and the
    // cursor fallback covers a cold currentLayerAt cache on the location the
    // user is viewing). Without this, pasting INTO such a location reads
    // existing=[] and the SET below wipes whatever children were already
    // there. null is fine here — a genuinely empty/new target legitimately
    // has no existing children. targetSegments IS the current location.
    const parent = await this.#resolveParentLayer(history, targetSegments, targetSegments)
    const existing = await childNamesOf(history, parent)
    const taken = new Set(existing)

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
      // Resolve the source cell's layer the authoritative way: through its
      // PARENT's children slot (pool-addressed sig → getLayerBySig), which
      // carries the cell's REAL subtree. A cell never navigated into has no
      // head in its own bag, so the old currentLayerAt(srcLocSig) returned
      // null for it and paste silently dropped a live tile. Fall back to the
      // own-bag head for the cut-in-place case (parent already dropped the
      // child, but the bag persists at srcLocSig).
      //
      // Resolve the source parent ROBUSTLY (resolveLayerAt walks the parent
      // chain to root). The bare currentLayerAt(sign(sourceSegments)) reads the
      // parent's OWN bag, which is COLD for the very location you just copied
      // from: the renderer paints the current page through the CURSOR, warming
      // a different cache than currentLayerAt's #latestSigByLineage. When that
      // read missed, childLayerOf found nothing and srcLayer fell back to the
      // copied cell's own bag — typically the auto-minted `{name}` seed with NO
      // children — so the re-home flattened the layer and the pasted tile lost
      // its whole hierarchy. Mirrors the target parent's #resolveParentLayer /
      // resolveLayerAt resolution.
      const srcParent = await resolveLayerAt(history, lineage.domain, entry.sourceSegments)
      const viaParent = await childLayerOf(history, srcParent, entry.label)
      const srcLayer = viaParent?.layer ?? await history.currentLayerAt(srcLocSig)
      if (!srcLayer) {
        console.warn(`[clipboard] paste source missing for '${entry.label}': /${entry.sourceSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }
      // Same source and destination lineage (cut-and-paste in place) needs no
      // re-home — the content never left its bag; the parent commit below
      // name-resolves it straight back into children. Otherwise flatten the
      // source subtree into importTree updates rooted at the dest path.
      if (srcLocSig !== dstLocSig) {
        try {
          treeUpdates.push(...await flattenLayerTree(history, srcLayer, [...targetSegments, entry.label]))
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

  // ── clear ─────────────────────────────────────────────

  async #clearClipboard(): Promise<void> {
    this.#clipboardSvc?.clear()
    const store = this.#store
    if (store) await clearDirectory(store.clipboard)
  }

  // ── validate ──────────────────────────────────────────
  // Drop entries that are DEFINITIVELY gone, so the clipboard count never
  // shows a tile that no longer exists. Called from restore and from
  // openClipboard before emitting view.
  //
  // CONSERVATIVE BY DESIGN: viewing the clipboard must never lose data.
  // Membership is resolved the authoritative way — through the source
  // PARENT's children slot (childLayerOf), the same path the renderer and
  // paste use. The previous check used currentLayerAt(sign(source+label)),
  // i.e. the CELL'S OWN bag, which is empty for any cell never navigated
  // into — so it false-flagged live tiles as ghosts, validate removed
  // them, and openClipboard then bailed on the now-empty clipboard
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

const _clipboard = new ClipboardWorker()
window.ioc.register('@diamondcoreprocessor.com/ClipboardWorker', _clipboard)
