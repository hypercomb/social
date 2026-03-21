// diamondcoreprocessor.com/core/clipboard/clipboard.drone.ts
import { Worker, EffectBus } from '@hypercomb/core'
import type { ClipboardService, ClipboardOp } from './clipboard.service.js'

const META_FILE = '__meta__'

interface SelectionLike {
  readonly selected: ReadonlySet<string>
  clear(): void
}

interface LineageLike {
  explorerSegments(): readonly string[]
  explorerDir(): Promise<FileSystemDirectoryHandle | null>
}

interface StoreLike {
  readonly hypercombRoot: FileSystemDirectoryHandle
  readonly clipboard: FileSystemDirectoryHandle
}

export class ClipboardWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Captures selected seeds into clipboard and pastes them at the current location.'

  protected override listens = [
    'controls:action',
    'keymap:invoke',
  ]

  protected override emits = [
    'clipboard:captured',
    'clipboard:paste-start',
    'clipboard:paste-done',
    'seed:added',
    'seed:removed',
  ]

  constructor() {
    super()

    EffectBus.on<{ action: string }>('controls:action', (payload) => {
      if (!payload?.action) return
      switch (payload.action) {
        case 'copy': this.#capture('copy'); break
        case 'cut': this.#capture('cut'); break
        case 'paste': void this.#paste(); break
        case 'place': void this.#place(); break
        case 'clear-clipboard': void this.#clearClipboard(); break
      }
    })

    EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (!payload?.cmd) return
      switch (payload.cmd) {
        case 'clipboard.copy': this.#capture('copy'); break
        case 'layout.cutCells': this.#capture('cut'); break
        case 'clipboard.paste': void this.#paste(); break
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

  // ── capture (copy or cut) ─────────────────────────────
  // Both record labels + source in clipboard service + persist meta.
  // Cut additionally emits seed:removed → HistoryRecorder records remove ops.
  // Folders stay in OPFS. History is the genome.

  #capture(op: ClipboardOp): void {
    const labels = this.#selectedLabels()
    if (labels.length === 0) return

    const segments = this.#lineage?.explorerSegments() ?? []
    this.#clipboardSvc?.capture(labels, segments, op)

    if (op === 'cut') {
      for (const label of labels) {
        EffectBus.emit('seed:removed', { seed: label })
      }
      this.#selection?.clear()
    }

    // Visual feedback — renderer picks this up for flash (copy) or disappear (cut)
    EffectBus.emit('clipboard:captured', { labels: [...labels], op })

    if (op === 'cut') {
      // Allow history remove ops to flush before triggering re-render
      setTimeout(() => window.dispatchEvent(new Event('synchronize')), 80)
    }

    // Persist metadata so clipboard survives reload
    void this.#persistMeta(op, labels, segments)
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
  // Reads seed trees from original source location (folders are still there).
  // Copies to current destination. Emits seed:added per label.

  async #paste(): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    if (!clipboardSvc) return

    const { items, op } = clipboardSvc.consume()
    if (items.length === 0) return

    EffectBus.emit('clipboard:paste-start', { count: items.length, op })

    // Emit seed:added for each item — HistoryRecorder records the ops
    for (const entry of items) {
      EffectBus.emit('seed:added', { seed: entry.label })
    }

    EffectBus.emit('clipboard:paste-done', { count: items.length, op })

    // Clean up persisted meta
    if (op === 'cut') {
      const store = this.#store
      if (store) await clearDirectory(store.clipboard)
    }
  }

  // ── place (selected clipboard items → current page) ──

  async #place(): Promise<void> {
    const clipboardSvc = this.#clipboardSvc
    if (!clipboardSvc || clipboardSvc.isEmpty) return

    // Only place items that are currently selected
    const selectedLabels = this.#selectedLabels()
    if (selectedLabels.length === 0) return

    const selectedSet = new Set(selectedLabels)
    const toPlace = clipboardSvc.items.filter(i => selectedSet.has(i.label))
    if (toPlace.length === 0) return

    // Emit seed:added for each selected item — HistoryRecorder records the ops
    for (const entry of toPlace) {
      EffectBus.emit('seed:added', { seed: entry.label })
    }

    // Remove placed items from clipboard
    clipboardSvc.removeItems(selectedSet)
    this.#selection?.clear()

    const store = this.#store

    // Update persisted meta or clear if empty
    if (clipboardSvc.isEmpty) {
      if (store) await clearDirectory(store.clipboard)
      // Auto-close clipboard mode
      EffectBus.emit('clipboard:view', { active: false })
    } else if (store) {
      await writeMeta(store.clipboard, {
        op: clipboardSvc.operation,
        items: clipboardSvc.items.map(i => ({
          label: i.label,
          sourceSegments: [...i.sourceSegments],
        })),
      })
      // Update clipboard view with remaining items
      EffectBus.emit('clipboard:view', {
        active: true,
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

  // ── restore from OPFS on startup ──────────────────────

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
  }
}

// ── meta persistence ──────────────────────────────────────

interface ClipboardMeta {
  op: ClipboardOp
  items: { label: string; sourceSegments: string[] }[]
}

async function writeMeta(
  clipDir: FileSystemDirectoryHandle,
  meta: ClipboardMeta,
): Promise<void> {
  try {
    const handle = await clipDir.getFileHandle(META_FILE, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(JSON.stringify(meta))
    } finally {
      await writable.close()
    }
  } catch { /* ignore */ }
}

async function readMeta(
  clipDir: FileSystemDirectoryHandle,
): Promise<ClipboardMeta | null> {
  try {
    const handle = await clipDir.getFileHandle(META_FILE, { create: false })
    const file = await handle.getFile()
    const text = await file.text()
    return JSON.parse(text) as ClipboardMeta
  } catch {
    return null
  }
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
