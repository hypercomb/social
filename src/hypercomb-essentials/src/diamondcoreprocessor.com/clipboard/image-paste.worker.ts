// diamondcoreprocessor.com/clipboard/image-paste.worker.ts
import { Worker, EffectBus } from '@hypercomb/core'
import type { TileEditorService } from '../editor/tile-editor.service.js'
import type { ImageEditorService } from '../editor/image-editor.service.js'
import type { SelectionService } from '../selection/selection.service.js'

export class ImagePasteWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Intercepts browser paste events containing images and routes them into the tile editor.'

  protected override emits = ['drop:pending', 'search:prefill']

  #pendingBlob: Blob | null = null
  #pendingSeedUnsub: (() => void) | null = null

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
      const seed = selection.active
      EffectBus.emit('tile:action', { action: 'edit', label: seed, q: 0, r: 0, index: 0 })
      await this.#waitForEditorMode()
      this.#editorService?.setLargeBlob(blob)
      await this.#loadImageWhenReady(blob)
      return
    }

    // Path C: nothing selected — stash blob, focus command line for seed name
    this.#pendingBlob = blob
    EffectBus.emit('drop:pending', { active: true })
    EffectBus.emit('search:prefill', { value: '' })

    // listen for seed:added — when user creates a seed, attach the image
    this.#pendingSeedUnsub?.()
    this.#pendingSeedUnsub = EffectBus.on<{ seed: string }>('seed:added', ({ seed }) => {
      if (!this.#pendingBlob) return
      const stashedBlob = this.#pendingBlob
      this.#clearPending()

      void (async () => {
        await new Promise<void>(r => setTimeout(r, 150))

        EffectBus.emit('tile:action', { action: 'edit', label: seed, q: 0, r: 0, index: 0 })
        await this.#waitForEditorMode()
        this.#editorService?.setLargeBlob(stashedBlob)
        await this.#loadImageWhenReady(stashedBlob)
      })()
    })

    // auto-cancel after 30s
    setTimeout(() => {
      if (this.#pendingBlob) this.#clearPending()
    }, 30_000)
  }

  // ── helpers ──────────────────────────────────────────────────

  #clearPending(): void {
    this.#pendingBlob = null
    this.#pendingSeedUnsub?.()
    this.#pendingSeedUnsub = null
    EffectBus.emit('drop:pending', { active: false })
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
