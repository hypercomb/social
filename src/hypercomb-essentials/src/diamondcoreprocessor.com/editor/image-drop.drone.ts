// diamondcoreprocessor.com/editor/image-drop.drone.ts
// Intercepts browser drag-and-drop image file events on the document
// and routes them into the tile editor for confirm/cancel.

import { Drone, EffectBus } from '@hypercomb/core'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'
import type { SelectionService } from '../selection/selection.service.js'

export class ImageDropDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Intercepts drag-and-drop image files from the desktop and routes them into the tile editor.'

  protected override emits = ['seed:added', 'drop:dragging']
  protected override listens = ['render:host-ready']

  #canvas: HTMLCanvasElement | null = null
  #busy = false
  #dragging = false
  #previewUrl: string | null = null
  #effectsRegistered = false

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
      // (browsers may restrict access during dragover, but some allow it)
      this.#tryExtractPreview(e)

      this.emitEffect('drop:dragging', { active: true, previewUrl: this.#previewUrl })
    }
  }

  #onDragLeave = (e: DragEvent): void => {
    // only clear when actually leaving the document (relatedTarget is null)
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

    // check the tile editor — if it's already open and the drop landed on its canvas,
    // let the TileEditorComponent handle it (it has its own drop handler)
    const editorSvc = this.#editorService
    if (editorSvc?.mode === 'editing') {
      // if the drop target is inside the editor panel, let it through
      const target = e.target as HTMLElement
      if (target?.closest?.('.editor-panel, .image-canvas, hc-tile-editor')) {
        this.#clearDragging()
        return // TileEditorComponent handles this
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
    this.#clearDragging()
    void this.#routeImage(imageFile)
  }

  // ── routing ───────────────────────────────────────────────────

  async #routeImage(file: File): Promise<void> {
    if (this.#busy) return
    this.#busy = true

    try {
      const blob = new Blob([await file.arrayBuffer()], { type: file.type })
      const editorSvc = this.#editorService

      // Path A: editor already open — replace image (user can still cancel)
      if (editorSvc?.mode === 'editing') {
        editorSvc.setLargeBlob(blob)
        await this.#loadImageWhenReady(blob)
        return
      }

      // Path B: tile selected — open editor for that tile, load image
      const selection = this.#selection
      if (selection && selection.count > 0 && selection.active) {
        const seed = selection.active
        EffectBus.emit('tile:action', { action: 'edit', label: seed, q: 0, r: 0, index: 0 })
        await this.#waitForEditorMode()
        this.#editorService?.setLargeBlob(blob)
        await this.#loadImageWhenReady(blob)
        return
      }

      // Path C: nothing selected — create new seed, open editor, load image
      const label = 'image-' + Date.now()
      EffectBus.emit('seed:added', { seed: label })

      // let history record the add before opening editor
      await new Promise<void>(r => setTimeout(r, 100))

      EffectBus.emit('tile:action', { action: 'edit', label, q: 0, r: 0, index: 0 })
      await this.#waitForEditorMode()
      this.#editorService?.setLargeBlob(blob)
      await this.#loadImageWhenReady(blob)
    } catch (err) {
      console.warn('[image-drop] failed:', err)
    } finally {
      this.#busy = false
    }
  }

  // ── preview extraction ────────────────────────────────────────

  #tryExtractPreview(e: DragEvent): void {
    // browsers restrict file access during dragover, but some
    // expose the file list. Try to create an object URL.
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

    // also try items API (Chrome sometimes allows it)
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

  get #selection(): SelectionService | undefined {
    return get('@diamondcoreprocessor.com/SelectionService') as SelectionService | undefined
  }
}

const _imageDrop = new ImageDropDrone()
window.ioc.register('@diamondcoreprocessor.com/ImageDropDrone', _imageDrop)
