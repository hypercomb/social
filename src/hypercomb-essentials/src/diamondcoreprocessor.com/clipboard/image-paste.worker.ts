// diamondcoreprocessor.com/clipboard/image-paste.worker.ts
import { Worker, EffectBus, hypercomb } from '@hypercomb/core'
import type { TileEditorService } from '../editor/tile-editor.service.js'
import type { ImageEditorService } from '../editor/image-editor.service.js'
import type { SelectionService } from '../selection/selection.service.js'

type Lineage = {
  explorerDir: () => Promise<FileSystemDirectoryHandle | null>
}

export class ImagePasteWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'clipboard'

  public override description =
    'Intercepts browser paste events containing images and routes them into the tile editor.'

  protected override emits = [] as string[]

  constructor() {
    super()
    document.addEventListener('paste', this.#onPaste)
  }

  protected override act = async (): Promise<void> => { }

  // ── paste handler ────────────────────────────────────────────

  #onPaste = (e: ClipboardEvent): void => {
    // don't steal text paste from inputs
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return

    // find the first image item
    const items = e.clipboardData?.items
    if (!items) return

    let file: File | null = null
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        file = items[i].getAsFile()
        if (file) break
      }
    }
    if (!file) return

    e.preventDefault()
    void this.#routeImage(file)
  }

  // ── routing ──────────────────────────────────────────────────

  async #routeImage(blob: Blob): Promise<void> {
    const editorSvc = this.#editorService

    // Path A: editor already open — replace image (user can still cancel)
    if (editorSvc?.mode === 'editing') {
      editorSvc.setLargeBlob(blob)
      await this.#loadImageWhenReady(blob)
      return
    }

    // Path B: tile selected — open editor for that tile, then load image
    const selection = this.#selection
    if (selection && selection.count > 0 && selection.active) {
      const cell = selection.active
      EffectBus.emit('tile:action', { action: 'edit', label: cell, q: 0, r: 0, index: 0 })
      await this.#waitForEditorMode()
      this.#editorService?.setLargeBlob(blob)
      await this.#loadImageWhenReady(blob)
      return
    }

    // Path C: nothing selected — auto-create cell, open editor immediately
    const cellName = await this.#createImageCell()
    if (!cellName) return

    await new Promise<void>(r => setTimeout(r, 150))

    EffectBus.emit('tile:action', { action: 'edit', label: cellName, q: 0, r: 0, index: 0 })
    await this.#waitForEditorMode()
    this.#editorService?.setLargeBlob(blob)
    await this.#loadImageWhenReady(blob)
  }

  // ── helpers ──────────────────────────────────────────────────

  async #createImageCell(): Promise<string | null> {
    // Tile creation is a layer mutation — read existing siblings from
    // the current layer's children, generate a unique name, emit
    // cell:added. LayerCommitter's cascade folds the new child sig
    // into the parent layer. No OPFS dir minted; the merkle tree is
    // where the new tile lives.
    const lineage = get('@hypercomb.social/Lineage') as (Lineage & {
      currentLayer?: () => Promise<unknown>
      explorerSegments?: () => readonly string[]
    }) | undefined
    if (!lineage) return null

    const history = get('@diamondcoreprocessor.com/HistoryService') as
      { getLayerBySig?: (s: string) => Promise<{ name?: string } | null> } | undefined
    const committer = get('@diamondcoreprocessor.com/LayerCommitter') as
      { update?: (segments: readonly string[], layer: { name?: string; [slot: string]: unknown }) => Promise<string> } | undefined

    // Resolve existing sibling names from the layer (single source of
    // truth for "what tiles are here"). When history/layer aren't ready
    // yet the set stays empty and we land on 'image'; first sibling
    // wins, the next paste resolves correctly on the following render.
    type ParentLayer = { name?: string; children?: readonly unknown[]; [slot: string]: unknown }
    const existingNames: string[] = []
    const existing = new Set<string>()
    let parentLayer: ParentLayer | null = null
    if (typeof lineage.currentLayer === 'function' && history?.getLayerBySig) {
      try {
        const raw = await lineage.currentLayer()
        parentLayer = (raw && typeof raw === 'object') ? raw as ParentLayer : null
        const childSigs: readonly unknown[] = Array.isArray(parentLayer?.children) ? parentLayer.children : []
        const resolved = await Promise.all(childSigs.map(async (cs: unknown) => {
          try {
            const child = await history.getLayerBySig!(String(cs ?? ''))
            return (typeof child?.name === 'string' && child.name.length > 0) ? child.name : ''
          } catch { return '' }
        }))
        for (const n of resolved) if (n) { existingNames.push(n); existing.add(n) }
      } catch { /* keep existing empty */ }
    }

    let finalName = 'image'
    if (existing.has(finalName)) {
      let counter = 2
      while (existing.has(`image-${counter}`)) counter++
      finalName = `image-${counter}`
    }

    const segments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    // Emit cell:added BEFORE committing so UI subscribers (show-cell
    // incremental mount, activity log) react instantly. viaUpdate skips
    // the LayerCommitter's per-event commit queue since the explicit
    // update() below IS the atomic commit.
    EffectBus.emit('cell:added', { cell: finalName, segments, viaUpdate: true })

    // ONE atomic layer commit: take the current parent layer, append the
    // new tile name, save.
    if (committer?.update) {
      const nextParent: { [slot: string]: unknown } = {}
      if (parentLayer) {
        for (const [k, v] of Object.entries(parentLayer)) {
          if (k === 'children') continue
          nextParent[k] = v
        }
      }
      nextParent['children'] = [...existingNames, finalName]
      await committer.update(segments, nextParent)
    }
    void new hypercomb().act()

    return finalName
  }

  async #waitForEditorMode(): Promise<void> {
    if (this.#editorService?.mode === 'editing') return
    await new Promise<void>(resolve => {
      const off = EffectBus.on<{ active: boolean }>('editor:mode', (payload) => {
        if (payload?.active) { off(); resolve() }
      })
      setTimeout(() => { off(); resolve() }, 2000)
    })
  }

  async #loadImageWhenReady(blob: Blob): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const ie = this.#imageEditor
      if (ie) {
        await ie.loadImage(blob)
        if (ie.hasImage) return // success — Pixi canvas was ready
      }
      await new Promise<void>(r => setTimeout(r, 100))
    }
  }

  get #editorService(): TileEditorService | undefined {
    return get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService | undefined
  }

  get #imageEditor(): ImageEditorService | undefined {
    return get('@diamondcoreprocessor.com/ImageEditorService') as ImageEditorService | undefined
  }

  get #selection(): SelectionService | undefined {
    return get('@diamondcoreprocessor.com/SelectionService') as SelectionService | undefined
  }
}

const _imagePaste = new ImagePasteWorker()
window.ioc.register('@diamondcoreprocessor.com/ImagePasteWorker', _imagePaste)
