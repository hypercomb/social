// clipboard/image-paste.worker.ts
//
// Ctrl+V (the browser paste event) with an image:
//   Editor open      → replace the picture in the editor.
//   A tile selected  → that picture replaces the one the tile wears.
//   Pointer on a tile → hold the picture in that tile's image collection.
//   Otherwise        → make a new tile and open the editor on the picture.
import { Worker, EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { childNamesOfStrict, type PlacementHistory } from '../history/layer-placement.js'
import type { TileEditorService } from '../editor/tile-editor.service.js'
import type { ImageEditorService } from '../editor/image-editor.service.js'
import type { SelectionService } from '../selection/selection.service.js'
import { announceHeldImages, announceReplacedPicture, holdImagesOnTile, replaceWornPicture } from '../sharing/tile-image-intake.js'

const t = (key: string, fallback: string): string => {
  try {
    const text = window.ioc?.get<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return text && text !== key ? text : fallback
  } catch { return fallback }
}

type Lineage = {
  explorerDir: () => Promise<FileSystemDirectoryHandle | null>
}

export class ImagePasteWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'clipboard'

  public override description =
    'Ctrl+V with an image: replace the selected tile, or hold it on the tile under the pointer.'

  protected override emits = ['toast:show'] as string[]

  /** The tile the pointer is on. Ctrl+V holds a picture there. */
  #hovered: string | null = null

  constructor() {
    super()
    document.addEventListener('paste', this.#onPaste)
    EffectBus.on<{ label?: string | null }>('tile:hover', (payload) => {
      const label = typeof payload?.label === 'string' ? payload.label.trim() : ''
      this.#hovered = label || null
    })
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

    // Path B: a selected tile wears the clipboard picture. Selection wins
    // over whatever the pointer happens to be resting on.
    const selected = this.#selectedLabel()
    if (selected) {
      const lineage = get('@hypercomb.social/Lineage') as
        { explorerSegments?: () => readonly string[] } | undefined
      const parent = (lineage?.explorerSegments?.() ?? [])
        .map(segment => String(segment ?? '').trim())
        .filter(Boolean)
      try {
        const replaced = await replaceWornPicture(parent, selected, blob)
        announceReplacedPicture(selected, replaced)
      } catch (error) {
        console.warn('[image-paste] the clipboard picture could not replace the tile', error)
        const failed = error as { name?: unknown; code?: unknown } | null
        if (failed?.name === 'QuotaExceededError' || failed?.code === 22) return
        EffectBus.emit('toast:show', {
          type: 'warning',
          message: t('drop.image-failed', 'That picture could not be added — try again, or try another picture.'),
        })
      }
      return
    }

    // Path C: the pointer is on a tile — the picture joins its collection.
    // The tile keeps what it wears; the images button offers the paste.
    const hovered = this.#hovered
    if (hovered) {
      const lineage = get('@hypercomb.social/Lineage') as
        { explorerSegments?: () => readonly string[] } | undefined
      const parent = (lineage?.explorerSegments?.() ?? [])
        .map(segment => String(segment ?? '').trim())
        .filter(Boolean)
      try {
        const held = await holdImagesOnTile(parent, hovered, [blob])
        announceHeldImages(hovered, held.added)
      } catch (error) {
        console.warn('[image-paste] the clipboard picture could not be held', error)
        const failed = error as { name?: unknown; code?: unknown } | null
        if (failed?.name === 'QuotaExceededError' || failed?.code === 22) return
        EffectBus.emit('toast:show', {
          type: 'warning',
          message: t('drop.image-failed', 'That picture could not be added — try again, or try another picture.'),
        })
      }
      return
    }

    // Path D: nothing selected and the pointer is on empty space — a new tile.
    await this.createTileFromImage(blob)
  }

  /** PUBLIC entry — "here is an image, make it a tile". Always a NEW
   *  cell at the current location, editor opened on it with the image loaded.
   *  Never routes into the selection, because the caller asked for a tile, not
   *  for a replacement (the mobile bar's camera shutter is the first caller —
   *  see hypercomb-shared/ui/camera-capture). Resolved through IoC by key, so
   *  the shell never imports this module. */
  readonly createTileFromImage = async (blob: Blob): Promise<void> => {
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

    // Resolve existing sibling names from the layer (single source of
    // truth for "what tiles are here") — only to choose a free name. The
    // read never becomes a write, so a sibling it could not resolve costs
    // at worst a name chosen twice, never the tile.
    const existing = new Set<string>()
    if (typeof lineage.currentLayer === 'function' && history?.getLayerBySig) {
      try {
        const raw = await lineage.currentLayer()
        const parentLayer = (raw && typeof raw === 'object') ? raw : null
        const strict = await childNamesOfStrict(history as unknown as PlacementHistory, parentLayer as unknown as Parameters<typeof childNamesOfStrict>[1])
        for (const n of strict.names) existing.add(n)
      } catch { /* no names known — 'image' is tried as is */ }
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

    // ONE APPEND, THROUGH THE COMMITTER'S OWN QUEUE. The committer adds the
    // name to the page's head — it merges, it never re-lists — so every
    // sibling rides through. This used to SET the whole children list from
    // NAMES whenever the read looked complete, and a name slot resolves each
    // sibling from its OWN bag: a sibling never committed at its own location
    // (installed content) came back as an empty {name} stand-in, and an
    // add that landed between the read and the write was undone.
    EffectBus.emit('cell:added', { cell: finalName, segments })
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

  /** The one selected tile, when the set is a single tile. */
  #selectedLabel(): string | null {
    const selection = this.#selection
    if (!selection || selection.count !== 1) return null
    const label = selection.active?.trim() ?? ''
    return label || null
  }
}

const _imagePaste = new ImagePasteWorker()
window.ioc.register('@diamondcoreprocessor.com/ImagePasteWorker', _imagePaste)
