// diamondcoreprocessor.com/editor/image-drop.drone.ts
// Intercepts browser drag-and-drop image file events on the document
// and routes them into the tile editor for confirm/cancel.
//
// Three paths:
//   Editor open  → replace image in current editor session.
//   Occupied hex → open editor for that tile with the new image.
//   Empty area   → arm the image in the command-line chevron slot; the
//                  user types a cell name and presses Enter to commit.

import { Drone, EffectBus } from '@hypercomb/core'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'
import { armImageBlob } from './arm-resource.js'

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
  override genotype = 'editor'

  public override description =
    'Intercepts drag-and-drop image files from the desktop and routes them into the tile editor.'

  protected override emits = ['drop:dragging', 'command:arm-resource']
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
    // Capture-phase safety: a child handler (e.g. the editor panel) may
    // call event.stopPropagation() in the bubble phase, preventing our
    // bubble-phase `drop` listener from seeing the event. Without this,
    // `drop:dragging` stays `true` forever, and the overlay renders as a
    // drop target (hex visible, icons hidden) after the editor closes.
    // The capture-phase listener runs BEFORE child handlers, so it
    // always sees the drop and can clear the flag. It does NOT
    // stopPropagation — the editor's own drop handler still runs.
    document.addEventListener('drop', this.#onDropCapture, true)
    document.addEventListener('dragend', this.#onDragEnd, true)
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

      // When the editor opens, any in-flight drag is now the editor's
      // responsibility — its drop handler calls stopPropagation(), so a
      // drop landing on the editor panel never reaches our document-level
      // listener, and #clearDragging() never fires. The `drop:dragging`
      // flag would stick at `true`, leaving the overlay in drop-target
      // mode after save (hex visible, icons hidden). Clear it preemptively
      // when the editor takes ownership of drops.
      this.onEffect<{ active: boolean }>('editor:mode', ({ active }) => {
        if (active && this.#dragging) this.#clearDragging()
      })
    }
  }

  // ── drag handlers ─────────────────────────────────────────────

  #onDragOver = (e: DragEvent): void => {
    // don't claim if over form inputs
    const tgt = e.target as HTMLElement | null
    if (tgt?.closest?.('input, textarea, select, [contenteditable]')) return

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

  /** Capture-phase drop listener. Always clears the dragging flag so a
   *  child handler that calls stopPropagation() can't strand `drop:dragging`
   *  at `true`. Does NOT preventDefault / stopPropagation — the bubble-
   *  phase #onDrop (which routes the file) and any child handlers still
   *  run normally. */
  #onDropCapture = (_e: DragEvent): void => {
    if (this.#dragging) this.#clearDragging()
  }

  #onDrop = (e: DragEvent): void => {
    // don't steal drops from inputs
    const tgt = e.target as HTMLElement | null
    if (tgt?.closest?.('input, textarea, select, [contenteditable]')) return

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

    // Typed-dropbox precedence: if the current view is a dropbox that
    // accepts this file, let FileDropDrone attach it as a document rather
    // than treating it as the tile's display image (e.g. a dropped svg).
    // We bow out silently — FileDropDrone handles the drop, and the
    // capture-phase #onDropCapture still clears our dragging flag.
    const dropbox = this.#dropbox
    if (dropbox?.active()) {
      const dropped = e.dataTransfer?.files
      if (dropped) {
        for (let i = 0; i < dropped.length; i++) {
          if (dropped[i].type.startsWith('image/') && dropbox.accepts(dropped[i])) return
        }
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

    // Path C: dropped on empty position — arm the resource in the command-line
    // chevron slot. The user types a cell name and presses Enter to commit.
    await this.#armResource(blob)
  }

  /**
   * Store the dropped image + a generated thumbnail as content-addressed
   * resources, then emit `command:arm-resource` for the command-line to show
   * the preview in its chevron slot. The actual tile creation happens on Enter.
   */
  async #armResource(blob: Blob): Promise<void> {
    await armImageBlob(blob, { type: 'image' })
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

  get #dropbox(): { active(): boolean; accepts(file: { name: string; type?: string }): boolean } | undefined {
    return get('@diamondcoreprocessor.com/DropboxService') as
      { active(): boolean; accepts(file: { name: string; type?: string }): boolean } | undefined
  }
}

const _imageDrop = new ImageDropDrone()
window.ioc.register('@diamondcoreprocessor.com/ImageDropDrone', _imageDrop)
