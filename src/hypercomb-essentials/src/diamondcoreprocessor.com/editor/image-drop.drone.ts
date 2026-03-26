// diamondcoreprocessor.com/editor/image-drop.drone.ts
// Intercepts browser drag-and-drop image file events on the document
// and routes them into the tile editor for confirm/cancel.
//
// Two paths:
//   Empty hex → stash blob, show placeholder, focus command line.
//               User types seed name → Enter → seed created → editor opens with image.
//   Occupied hex → open editor for that tile with the new image for reposition/save/cancel.

import { Drone, EffectBus } from '@hypercomb/core'
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

export class ImageDropDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Intercepts drag-and-drop image files from the desktop and routes them into the tile editor.'

  protected override emits = ['drop:dragging', 'drop:pending', 'search:prefill']
  protected override listens = ['render:host-ready', 'drop:target', 'seed:added', 'editor:mode']

  #canvas: HTMLCanvasElement | null = null
  #dragging = false
  #previewUrl: string | null = null
  #effectsRegistered = false

  /** Last hex position reported by TileOverlayDrone during drag. */
  #lastTarget: DropTarget | null = null

  /** Stashed image blob waiting for the user to name the seed. */
  #pendingBlob: Blob | null = null
  #pendingSeedUnsub: (() => void) | null = null

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
    // don't claim if over form inputs (unless we have a pending drop — then we want
    // to keep the browser from doing its own thing while user types in the command line)
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) {
      // still allow if we're in pending-drop state (user is typing seed name)
      if (!this.#pendingBlob) return
    }

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

    // Path C: dropped on empty position — stash blob, show placeholder, focus command line
    this.#pendingBlob = blob
    this.emitEffect('drop:pending', { active: true })

    // focus the command line so user can type the seed name
    EffectBus.emit('search:prefill', { value: '' })

    // listen for seed:added — when the user creates a seed, attach the image
    this.#pendingSeedUnsub?.()
    this.#pendingSeedUnsub = EffectBus.on<{ seed: string }>('seed:added', ({ seed }) => {
      if (!this.#pendingBlob) return
      const stashedBlob = this.#pendingBlob
      this.#clearPending()

      // open editor for the new seed with the stashed image
      void (async () => {
        // brief delay — let history record the seed:added op and processor pulse
        await new Promise<void>(r => setTimeout(r, 150))

        EffectBus.emit('tile:action', { action: 'edit', label: seed, q: 0, r: 0, index: 0 })
        await this.#waitForEditorMode()
        this.#editorService?.setLargeBlob(stashedBlob)
        await this.#loadImageWhenReady(stashedBlob)
      })()
    })

    // auto-cancel if no seed is created within 30 seconds
    setTimeout(() => {
      if (this.#pendingBlob) this.#clearPending()
    }, 30_000)
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

  #clearPending(): void {
    this.#pendingBlob = null
    this.#pendingSeedUnsub?.()
    this.#pendingSeedUnsub = null
    this.emitEffect('drop:pending', { active: false })
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
