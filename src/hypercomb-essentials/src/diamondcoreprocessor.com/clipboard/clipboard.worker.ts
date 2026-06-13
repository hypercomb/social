// diamondcoreprocessor.com/core/clipboard/clipboard.worker.ts
import { Worker, EffectBus, hypercomb } from '@hypercomb/core'
import type { ClipboardService, ClipboardOp } from './clipboard.service.js'

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
}

interface StoreLike {
  readonly clipboard: FileSystemDirectoryHandle
}

/** Resolve a parent layer's `children` sigs to child display names.
 *  Names are the truth — each child layer's own `name` field — and the
 *  committer re-resolves them to head sigs at commit time. Mirrors the
 *  resolution RemoveQueenBee and show-cell use so membership edits all
 *  agree on the same authoritative list. */
async function childNamesOf(
  history: HistoryServiceLike,
  parent: LayerLike | null,
): Promise<string[]> {
  const childSigs = Array.isArray(parent?.children) ? parent!.children : []
  const names: string[] = []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (child && typeof child.name === 'string' && child.name.length > 0) {
      names.push(child.name)
    }
  }
  return names
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
        case 'place': void this.#place(); break
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

    // Render-side ghost detection: the view couldn't resolve these labels
    // to actual cells in the dir, so drop them from the service. Keeps the
    // clipboard count honest end-to-end.
    EffectBus.on<{ labels: string[] }>('clipboard:ghost-detected', (payload) => {
      const svc = this.#clipboardSvc
      if (!svc || !payload?.labels?.length) return
      svc.removeItems(new Set(payload.labels))
      const store = this.#store
      if (svc.isEmpty) {
        if (store) void clearDirectory(store.clipboard)
        EffectBus.emit('clipboard:view', { active: false })
      } else if (store) {
        void writeMeta(store.clipboard, {
          op: svc.operation,
          items: svc.items.map(i => ({
            label: i.label,
            sourceSegments: [...i.sourceSegments],
          })),
        })
      }
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
        const parentLocSig = await history.sign({
          domain: lineage.domain,
          explorerSegments: () => parentSegs,
        })
        const parent = await history.currentLayerAt(parentLocSig)
        const survivors = (await childNamesOf(history, parent)).filter(n => !leaves.has(n))

        // Eager visual unmount; `viaUpdate` tells the committer's per-
        // event listener to skip queueing — the update() below IS the
        // atomic commit for this action.
        for (const leaf of leaves) {
          EffectBus.emit('cell:removed', { cell: leaf, segments: [...parentSegs], viaUpdate: true })
        }
        await committer.update(parentSegs, { ...(parent ?? {}), children: survivors })
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
    const lineage = this.#lineage
    const store = this.#store
    const history = this.#history
    const committer = this.#committer
    if (!clipboardSvc || !lineage || !store || !history || !committer) return
    if (clipboardSvc.isEmpty) return

    const op = clipboardSvc.operation
    const items = clipboardSvc.items
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
    const targetLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => targetSegments,
    })
    const parent = await history.currentLayerAt(targetLocSig)
    const existing = await childNamesOf(history, parent)
    const taken = new Set(existing)

    const placed: ClipboardEntry[] = []
    const failed: string[] = []
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
      const srcLayer = await history.currentLayerAt(srcLocSig)
      if (!srcLayer) {
        console.warn(`[clipboard] paste source missing for '${entry.label}': /${entry.sourceSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }
      // Same source and destination lineage (cut-and-paste in place) needs
      // no clone — the content never left its bag.
      if (srcLocSig !== dstLocSig) {
        try {
          await cloneLayerTree(history, lineage, srcLayer, [...targetSegments, entry.label])
        } catch (err) {
          console.warn(`[clipboard] clone failed for '${entry.label}':`, err)
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
    const nextChildren = [...existing, ...placed.map(p => p.label)]
    await committer.update(targetSegments, { ...(parent ?? {}), children: nextChildren })
    await new hypercomb().act()

    return { placed, failed }
  }

  // ── place (selected clipboard items → current page) ──

  async #place(): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    const lineage = this.#lineage
    const store = this.#store
    const history = this.#history
    const committer = this.#committer
    if (!clipboardSvc || !lineage || !store || !history || !committer) return
    if (clipboardSvc.isEmpty) return

    const selectedLabels = this.#selectedLabels()
    if (selectedLabels.length === 0) return

    const selectedSet = new Set(selectedLabels)
    const toPlace = clipboardSvc.items.filter(i => selectedSet.has(i.label))
    if (toPlace.length === 0) return

    const targetSegments = [...lineage.explorerSegments()]
    const { placed } = await this.#placeItems(history, lineage, committer, toPlace, targetSegments)

    const placedLabels = placed.map(p => p.label)
    if (placedLabels.length === 0) return

    clipboardSvc.removeItems(new Set(placedLabels))
    this.#selection?.clear()

    if (clipboardSvc.isEmpty) {
      await clearDirectory(store.clipboard)
      EffectBus.emit('clipboard:view', { active: false })
    } else {
      await writeMeta(store.clipboard, {
        op: clipboardSvc.operation,
        items: clipboardSvc.items.map(i => ({
          label: i.label,
          sourceSegments: [...i.sourceSegments],
        })),
      })
      EffectBus.emit('clipboard:view', {
        active: true,
        op: clipboardSvc.operation,
        labels: clipboardSvc.items.map(i => i.label),
        sourceSegments: [...(clipboardSvc.items[0]?.sourceSegments ?? [])],
      })
    }
  }

  // ── clear ─────────────────────────────────────────────

  async #clearClipboard(): Promise<void> {
    this.#clipboardSvc?.clear()
    const store = this.#store
    if (store) await clearDirectory(store.clipboard)
  }

  // ── validate ──────────────────────────────────────────
  // Drop entries whose underlying folder can't be resolved, so the
  // clipboard count never shows a tile the view can't actually render.
  // Called from restore and from openClipboard before emitting view.

  async validate(): Promise<void> {
    const svc = this.#clipboardSvc
    const store = this.#store
    const lineage = this.#lineage
    if (!svc || !store || svc.isEmpty) return

    const history = this.#history
    if (!lineage || !history) return

    // An entry is valid iff its source cell's layer still resolves. For
    // copy the cell is still in place; for cut the cell's own bag persists
    // (cut only drops it from the parent's children). Either way the
    // lineage sig addresses a head layer — null means the source is gone
    // and the entry is a ghost to drop.
    const items = svc.items
    const invalid = new Set<string>()
    for (const entry of items) {
      const locSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => [...entry.sourceSegments, entry.label],
      })
      const layer = await history.currentLayerAt(locSig)
      if (!layer) invalid.add(entry.label)
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

// ── layer subtree cloning (sig-only, no OPFS folder mirror) ──────────
//
// Under the layer-primitive doctrine a cell IS its layer: content
// (children, properties, notes, …) lives in the history bag addressed by
// the cell's lineage sig, and the parent merely references the cell's
// head sig in its `children` slot. Copy / cut / paste never moves bytes —
// it re-points `children` slots (the committer at the call sites does
// that) and, for paste into a DIFFERENT location, re-homes the cell's
// layer subtree so the moved/copied cell is reachable at its destination
// lineage too.
//
// `cloneLayerTree` walks the subtree purely through the merkle backbone:
// the cell's layer holds child SIGS, each resolves to a child layer via
// `getLayerBySig` (content-addressed, location-independent), and we
// re-commit each layer at its destination lineage sig. The child sigs
// inside a cloned layer stay valid verbatim — they resolve through the
// global pool regardless of which bag's marker points at them — so the
// clone's only effect is one destination marker per node, making the
// content reachable by navigating the new path. No OPFS walk; the source
// folders don't exist in this architecture.
async function cloneLayerTree(
  history: HistoryServiceLike,
  lineage: LineageLike,
  layer: LayerLike,
  destCellSegments: readonly string[],
): Promise<void> {
  const dstLocSig = await history.sign({
    domain: lineage.domain,
    explorerSegments: () => destCellSegments,
  })
  await history.commitLayer(dstLocSig, layer)

  const childSigs = Array.isArray(layer.children) ? layer.children : []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (!child || typeof child.name !== 'string' || child.name.length === 0) continue
    await cloneLayerTree(history, lineage, child, [...destCellSegments, child.name])
  }
}

const _clipboard = new ClipboardWorker()
window.ioc.register('@diamondcoreprocessor.com/ClipboardWorker', _clipboard)
