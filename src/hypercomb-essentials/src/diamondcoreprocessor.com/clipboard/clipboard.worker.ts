// diamondcoreprocessor.com/core/clipboard/clipboard.worker.ts
import { Worker, EffectBus, hypercomb } from '@hypercomb/core'
import type { ClipboardService, ClipboardOp } from './clipboard.service.js'

const META_FILE = '__meta__'

interface SelectionLike {
  readonly selected: ReadonlySet<string>
  clear(): void
}

interface LineageLike {
  explorerSegments(): readonly string[]
  explorerDir(): Promise<FileSystemDirectoryHandle | null>
  tryResolve(
    segments: readonly string[],
    start?: FileSystemDirectoryHandle,
  ): Promise<FileSystemDirectoryHandle | null>
  readonly domain?: unknown
}

interface HistoryServiceLike {
  sign(lineage: { domain?: unknown; explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<unknown>
  commitLayer(locationSig: string, layer: unknown): Promise<string>
}

interface StoreLike {
  readonly clipboard: FileSystemDirectoryHandle
  readonly hypercombRoot: FileSystemDirectoryHandle
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
    const store = this.#store
    const segments = lineage?.explorerSegments() ?? []

    if (op === 'cut') {
      if (!store || !lineage) return
      const sourceDir = await lineage.explorerDir()
      if (!sourceDir) return

      // Move each cell folder out of source, into store.clipboard.
      // Skip labels that fail (don't exist, name collision in clipboard).
      const moved: string[] = []
      // Clear any prior clipboard contents first so the new cut owns the dir.
      await clearDirectory(store.clipboard)
      for (const label of labels) {
        const ok = await moveCellFolder(sourceDir, store.clipboard, label)
        if (ok) moved.push(label)
      }
      if (moved.length === 0) return

      this.#clipboardSvc?.capture(moved, segments, 'cut')

      for (const label of moved) {
        EffectBus.emit('cell:removed', { cell: label, segments: [...segments] })
      }
      this.#selection?.clear()

      EffectBus.emit('clipboard:captured', { labels: [...moved], op: 'cut' })

      // Allow history remove ops to flush before triggering re-render
      setTimeout(() => void new hypercomb().act(), 80)

      void this.#persistMeta('cut', moved, segments)
      return
    }

    // copy: leave folders in place
    this.#clipboardSvc?.capture(labels, segments, 'copy')
    EffectBus.emit('clipboard:captured', { labels: [...labels], op: 'copy' })
    void this.#persistMeta('copy', labels, segments)
  }

  async #persistMeta(op: ClipboardOp, labels: string[], segments: readonly string[]): Promise<void> {
    const store = this.#store
    if (!store) return
    await writeMeta(store.clipboard, {
      op,
      items: labels.map(label => ({ label, sourceSegments: [...segments] })),
    })
  }

  // ── paste ─────────────────────────────────────────────
  // cut:  move folders from store.clipboard back to current explorer dir.
  // copy: copy folders from sourceSegments to current explorer dir.

  async #paste(): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    const lineage = this.#lineage
    const store = this.#store
    if (!clipboardSvc || !lineage || !store) return

    if (clipboardSvc.isEmpty) return

    const targetDir = await lineage.explorerDir()
    if (!targetDir) return

    const op = clipboardSvc.operation
    const items = clipboardSvc.items
    const targetSegments = [...lineage.explorerSegments()]
    const history = this.#history

    EffectBus.emit('clipboard:paste-start', { count: items.length, op })

    const placed: { label: string; sourceSegments: readonly string[] }[] = []
    const failed: string[] = []
    if (op === 'cut') {
      for (const entry of items) {
        const ok = await moveCellFolder(store.clipboard, targetDir, entry.label)
        if (ok) placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
        else failed.push(entry.label)
      }
    } else {
      for (const entry of items) {
        const sourceDir = await lineage.tryResolve(entry.sourceSegments, store.hypercombRoot)
        if (!sourceDir) {
          console.warn(`[clipboard] copy source missing for '${entry.label}': /${entry.sourceSegments.join('/')}`)
          failed.push(entry.label)
          continue
        }
        const ok = await copyCellFolder(sourceDir, targetDir, entry.label)
        if (ok) placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
        else failed.push(entry.label)
      }
    }

    if (history) {
      for (const entry of placed) {
        await cloneSubtreeLayers(
          history,
          lineage,
          targetDir,
          entry.sourceSegments,
          targetSegments,
          entry.label,
        )
      }
    }

    for (const entry of placed) {
      EffectBus.emit('cell:added', { cell: entry.label, segments: [...targetSegments] })
    }

    const placedLabels = placed.map(p => p.label)
    // cut: drop only the items that actually moved. Failed moves stay on
    // the clipboard so the user doesn't lose data on a partial / stale paste.
    // copy: leaves clipboard intact for repeat paste.
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

  // ── place (selected clipboard items → current page) ──

  async #place(): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    const lineage = this.#lineage
    const store = this.#store
    if (!clipboardSvc || !lineage || !store) return
    if (clipboardSvc.isEmpty) return

    const selectedLabels = this.#selectedLabels()
    if (selectedLabels.length === 0) return

    const selectedSet = new Set(selectedLabels)
    const toPlace = clipboardSvc.items.filter(i => selectedSet.has(i.label))
    if (toPlace.length === 0) return

    const targetDir = await lineage.explorerDir()
    if (!targetDir) return

    const op = clipboardSvc.operation
    const targetSegments = [...lineage.explorerSegments()]
    const history = this.#history
    const placed: { label: string; sourceSegments: readonly string[] }[] = []
    if (op === 'cut') {
      for (const entry of toPlace) {
        const ok = await moveCellFolder(store.clipboard, targetDir, entry.label)
        if (ok) placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
      }
    } else {
      for (const entry of toPlace) {
        const sourceDir = await lineage.tryResolve(entry.sourceSegments, store.hypercombRoot)
        if (!sourceDir) {
          console.warn(`[clipboard] place: copy source missing for '${entry.label}': /${entry.sourceSegments.join('/')}`)
          continue
        }
        const ok = await copyCellFolder(sourceDir, targetDir, entry.label)
        if (ok) placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
      }
    }

    if (history) {
      for (const entry of placed) {
        await cloneSubtreeLayers(
          history,
          lineage,
          targetDir,
          entry.sourceSegments,
          targetSegments,
          entry.label,
        )
      }
    }

    for (const entry of placed) {
      EffectBus.emit('cell:added', { cell: entry.label, segments: [...targetSegments] })
    }

    const placedLabels = placed.map(p => p.label)
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

    const op = svc.operation
    const items = svc.items
    const invalid = new Set<string>()

    if (op === 'cut') {
      for (const entry of items) {
        try {
          await store.clipboard.getDirectoryHandle(entry.label, { create: false })
        } catch {
          invalid.add(entry.label)
        }
      }
    } else {
      for (const entry of items) {
        const srcDir = lineage
          ? await lineage.tryResolve(entry.sourceSegments, store.hypercombRoot)
          : null
        if (!srcDir) { invalid.add(entry.label); continue }
        try {
          await srcDir.getDirectoryHandle(entry.label, { create: false })
        } catch {
          invalid.add(entry.label)
        }
      }
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

// ── merkle layer cloning ─────────────────────────────────
// Folder copy/move only touches OPFS bytes under hypercomb.io/. The
// merkle layer for each cell — which holds children, body, tags, notes,
// and any other slot data — lives in __history__/{locationSig}/, where
// locationSig hashes the lineage path. Moving the folder changes the
// lineage path, so the destination's bag is empty and the cell appears
// to have lost its hierarchy (and any other slot state).
//
// This walks the destination subtree (now in OPFS at its new location)
// and, for each cell, copies the source bag's head layer into the
// destination bag's first marker. Layer content is content-addressed,
// so children sigs inside the copied layer still resolve via the global
// preloader cache regardless of which bag physically stores them.

async function cloneSubtreeLayers(
  history: HistoryServiceLike,
  lineage: LineageLike,
  destParentDir: FileSystemDirectoryHandle,
  sourceParentSegments: readonly string[],
  destParentSegments: readonly string[],
  label: string,
): Promise<void> {
  let cellDir: FileSystemDirectoryHandle
  try {
    cellDir = await destParentDir.getDirectoryHandle(label, { create: false })
  } catch {
    return
  }
  await cloneLayerRecursive(
    history,
    lineage,
    cellDir,
    [...sourceParentSegments, label],
    [...destParentSegments, label],
  )
}

async function cloneLayerRecursive(
  history: HistoryServiceLike,
  lineage: LineageLike,
  cellDir: FileSystemDirectoryHandle,
  sourceCellSegments: readonly string[],
  destCellSegments: readonly string[],
): Promise<void> {
  try {
    const oldLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => sourceCellSegments,
    })
    const newLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => destCellSegments,
    })
    if (oldLocSig !== newLocSig) {
      const layer = await history.currentLayerAt(oldLocSig)
      if (layer) {
        await history.commitLayer(newLocSig, layer)
      }
    }
  } catch (err) {
    console.warn(`[clipboard] layer clone failed for /${destCellSegments.join('/')}:`, err)
  }

  const subdirs: { name: string; handle: FileSystemDirectoryHandle }[] = []
  for await (const [name, handle] of (cellDir as any).entries()) {
    if (handle.kind === 'directory') {
      subdirs.push({ name, handle: handle as FileSystemDirectoryHandle })
    }
  }
  for (const sub of subdirs) {
    await cloneLayerRecursive(
      history,
      lineage,
      sub.handle,
      [...sourceCellSegments, sub.name],
      [...destCellSegments, sub.name],
    )
  }
}

// ── OPFS folder copy / move ──────────────────────────────

async function copyDirectory(
  src: FileSystemDirectoryHandle,
  dest: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, handle] of (src as any).entries()) {
    if (handle.kind === 'file') {
      const srcFile = await (handle as FileSystemFileHandle).getFile()
      const destFile = await dest.getFileHandle(name, { create: true })
      const writable = await destFile.createWritable()
      try {
        await writable.write(await srcFile.arrayBuffer())
      } finally {
        await writable.close()
      }
    } else if (handle.kind === 'directory') {
      const srcDir = handle as FileSystemDirectoryHandle
      const destDir = await dest.getDirectoryHandle(name, { create: true })
      await copyDirectory(srcDir, destDir)
    }
  }
}

// Returns true on success, false if source missing, destination collides,
// or the copy fails partway. On copy failure the partial destination is
// cleaned up so no orphan folders linger.
async function copyCellFolder(
  sourceParent: FileSystemDirectoryHandle,
  destParent: FileSystemDirectoryHandle,
  label: string,
): Promise<boolean> {
  let src: FileSystemDirectoryHandle
  try {
    src = await sourceParent.getDirectoryHandle(label, { create: false })
  } catch {
    return false
  }
  try {
    await destParent.getDirectoryHandle(label, { create: false })
    console.warn(`[clipboard] destination already has '${label}'; skipping`)
    return false
  } catch { /* good — name available */ }

  let dest: FileSystemDirectoryHandle
  try {
    dest = await destParent.getDirectoryHandle(label, { create: true })
    await copyDirectory(src, dest)
    return true
  } catch (err) {
    console.warn(`[clipboard] copy failed for '${label}':`, err)
    try {
      await destParent.removeEntry(label, { recursive: true })
    } catch { /* leave whatever's there — best effort cleanup */ }
    return false
  }
}

// Move = copy then delete source. If the source delete fails after a
// successful copy, roll the destination back so the cell isn't left
// duplicated in both places.
async function moveCellFolder(
  sourceParent: FileSystemDirectoryHandle,
  destParent: FileSystemDirectoryHandle,
  label: string,
): Promise<boolean> {
  const ok = await copyCellFolder(sourceParent, destParent, label)
  if (!ok) return false
  try {
    await sourceParent.removeEntry(label, { recursive: true })
    return true
  } catch (err) {
    console.warn(`[clipboard] source remove failed for '${label}', rolling back:`, err)
    try {
      await destParent.removeEntry(label, { recursive: true })
    } catch { /* best effort */ }
    return false
  }
}

const _clipboard = new ClipboardWorker()
window.ioc.register('@diamondcoreprocessor.com/ClipboardWorker', _clipboard)
