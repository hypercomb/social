// diamondcoreprocessor.com/editor/image-drop.drone.ts
// Intercepts browser drag-and-drop image file events on the document
// and routes them into the tile editor for confirm/cancel.
//
// Three paths:
//   Editor open  → replace image in current editor session.
//   Occupied hex → open editor for that tile with the new image.
//   Empty area   → auto-create cell from file name, open editor immediately.

import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'

type DropTarget = {
  q: number
  r: number
  occupied: boolean
  label: string | null
  index: number
  hasImage: boolean
}

type Lineage = {
  explorerDir: () => Promise<FileSystemDirectoryHandle | null>
}

export class ImageDropDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'editor'

  public override description =
    'Intercepts drag-and-drop image files from the desktop and routes them into the tile editor.'

  protected override emits = ['drop:dragging']
  protected override listens = ['render:host-ready', 'drop:target', 'editor:mode']

  #canvas: HTMLCanvasElement | null = null
  #dragging = false
  #previewUrl: string | null = null
  #effectsRegistered = false

  /** Last hex position reported by TileOverlayDrone during drag. */
  #lastTarget: DropTarget | null = null

  constructor() {
    super()
    document.addEventListener('dragover', this.#onDragOver)
    document.addEventListener('dragleave', this.#onDragLeave)
    document.addEventListener('drop', this.#onDrop)
    document.addEventListener('dragend', this.#onDragEnd)
  }

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      this.onEffect<{ canvas: HTMLCanvasElement }>('render:host-ready', (payload) => {
        this.#canvas = payload.canvas
      })

      // cache the latest drop target emitted by TileOverlayDrone during drag
      this.onEffect<DropTarget>('drop:target', (target) => {
        this.#lastTarget = target
      })
    }
  }

  // ── drag handlers ─────────────────────────────────────────────

  #onDragOver = (e: DragEvent): void => {
    // don't claim if over form inputs
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return

    // only claim if it looks like files (not a link-only drag)
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('Files')) return

    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'

    // emit dragging state so the overlay can show a drop target
    if (!this.#dragging) {
      this.#dragging = true

      // try to read the dragged image for preview
      this.#tryExtractPreview(e)

      this.emitEffect('drop:dragging', { active: true, previewUrl: this.#previewUrl })
    }
  }

  #onDragLeave = (e: DragEvent): void => {
    if (e.relatedTarget) return
    this.#clearDragging()
  }

  #onDragEnd = (): void => {
    this.#clearDragging()
  }

  #onDrop = (e: DragEvent): void => {
    // don't steal drops from inputs
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return

    // don't steal non-file drops (those go to LinkDropWorker)
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('Files')) return

    // if editor is already open and drop landed on its panel, let TileEditorComponent handle it
    const editorSvc = this.#editorService
    if (editorSvc?.mode === 'editing') {
      const target = e.target as HTMLElement
      if (target?.closest?.('.editor-panel, .image-canvas, hc-tile-editor')) {
        this.#clearDragging()
        return
      }
    }

    // find the first image file
    const files = e.dataTransfer?.files
    if (!files) { this.#clearDragging(); return }

    let imageFile: File | null = null
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) {
        imageFile = files[i]
        break
      }
    }

    if (!imageFile) { this.#clearDragging(); return }

    e.preventDefault()

    // snapshot the target before clearing drag state
    const dropTarget = this.#lastTarget
    this.#clearDragging()

    void this.#routeImage(imageFile, dropTarget)
  }

  // ── routing ───────────────────────────────────────────────────

  async #routeImage(file: File, target: DropTarget | null): Promise<void> {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type })
    const editorSvc = this.#editorService

    // Path A: editor already open — replace image (user can still cancel via editor)
    if (editorSvc?.mode === 'editing') {
      editorSvc.setLargeBlob(blob)
      await this.#loadImageWhenReady(blob)
      return
    }

    // Path B: dropped on an occupied tile — open editor for that tile with the new image
    if (target?.occupied && target.label) {
      EffectBus.emit('tile:action', {
        action: 'edit',
        label: target.label,
        q: target.q,
        r: target.r,
        index: target.index,
      })
      await this.#waitForEditorMode()
      this.#editorService?.setLargeBlob(blob)
      await this.#loadImageWhenReady(blob)
      return
    }

    // Path C: dropped on empty position — auto-create cell from file name, open editor immediately
    const cellName = await this.#createCellFromFile(file.name)
    if (!cellName) return

    // brief delay — let history record the cell:added op and processor pulse
    await new Promise<void>(r => setTimeout(r, 150))

    EffectBus.emit('tile:action', { action: 'edit', label: cellName, q: 0, r: 0, index: 0 })
    await this.#waitForEditorMode()
    this.#editorService?.setLargeBlob(blob)
    await this.#loadImageWhenReady(blob)
  }

  // ── preview extraction ────────────────────────────────────────

  #tryExtractPreview(e: DragEvent): void {
    if (this.#previewUrl) return

    try {
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        const file = files[0]
        if (file.type.startsWith('image/')) {
          this.#previewUrl = URL.createObjectURL(file)
        }
      }
    } catch {
      // expected — most browsers block file access during dragover
    }

    if (!this.#previewUrl) {
      try {
        const items = e.dataTransfer?.items
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
              const file = items[i].getAsFile()
              if (file) {
                this.#previewUrl = URL.createObjectURL(file)
                break
              }
            }
          }
        }
      } catch {
        // fallback — no preview available during drag
      }
    }
  }

  // ── helpers ───────────────────────────────────────────────────

  #clearDragging(): void {
    if (!this.#dragging) return
    this.#dragging = false

    if (this.#previewUrl) {
      URL.revokeObjectURL(this.#previewUrl)
      this.#previewUrl = null
    }

    this.emitEffect('drop:dragging', { active: false, previewUrl: null })
  }

  async #createCellFromFile(fileName: string): Promise<string | null> {
    const lineage = get('@hypercomb.social/Lineage') as Lineage | undefined
    if (!lineage) return null

    const dir = await lineage.explorerDir()
    if (!dir) return null

    // derive cell name: strip extension, lowercase, replace non-alphanumeric with hyphens
    const baseName = fileName.replace(/\.[^.]+$/, '')
    let cellName = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!cellName) cellName = 'image'

    // deduplicate: if cell already exists, append incrementing number
    const existing = new Set<string>()
    for await (const key of dir.keys()) {
      existing.add(key)
    }
    let finalName = cellName
    if (existing.has(finalName)) {
      let counter = 2
      while (existing.has(`${cellName}-${counter}`)) counter++
      finalName = `${cellName}-${counter}`
    }

    // create cell directory in OPFS
    await dir.getDirectoryHandle(finalName, { create: true })

    // emit cell:added — HistoryRecorder will record the op
    EffectBus.emit('cell:added', { cell: finalName })

    // trigger processor pulse
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
        if (ie.hasImage) return
      }
      await new Promise<void>(r => setTimeout(r, 100))
    }
  }

  // ── IoC accessors ─────────────────────────────────────────────

  get #editorService(): TileEditorService | undefined {
    return get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService | undefined
  }

  get #imageEditor(): ImageEditorService | undefined {
    return get('@diamondcoreprocessor.com/ImageEditorService') as ImageEditorService | undefined
  }
}

const _imageDrop = new ImageDropDrone()
window.ioc.register('@diamondcoreprocessor.com/ImageDropDrone', _imageDrop)
