// diamondcoreprocessor.com/files/file-drop.drone.ts
//
// The files worker: drop files onto tiles in a dropbox subtree, then list
// / download / detach them behind the tile's file icon — for a single
// tile, a selection of tiles, or the whole view.
//
//   DROP   — drop a document anywhere on the hive (no `/dropbox` needed).
//            On an existing tile it attaches as a `files:attachment`
//            decoration. On empty space a single file ARMS the command-line
//            with a default dropbox background (image-before-text flow): name
//            it, press Enter, and the tile is created with that background +
//            the file attached. Several files at once auto-create one tile
//            each. A typed `/dropbox` still constrains which files are taken
//            via its accept filter; images keep flowing to image-drop.drone.ts
//            as the tile's display picture.
//
//   CLICK  — the file icon emits `tile:action {action:'files'}`; we answer
//            with `files:open` carrying that tile's file list.
//
//   SCOPE  — `/files` emits `files:open-scope {scope, labels?}`; we
//            aggregate attachments across the selected tiles ('selection')
//            or every tile in view that has files ('all'), tagging each
//            file with its source tile.
//
//   PANEL  — `files:remove` detaches; the open list live-refreshes on
//            `decorations:changed`.

import { Drone, EffectBus, normalizeCell } from '@hypercomb/core'
import { writeAttachment, listAttachments, removeAttachment, FILES_ATTACHMENT_KIND, type AttachmentPayload } from './files-attachment.js'
import { hasDecorationKind } from '../commands/decoration-kind-index.js'
import { armImageBlob, storeImageResources } from '../editor/arm-resource.js'
import { dropboxBackgroundBlob } from './dropbox-background.js'
import { extOf } from './file-types.js'

/** mime / extension that image-drop.drone.ts owns as a tile DISPLAY image. */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic'])
const isImageFile = (f: { name: string; type?: string }): boolean =>
  (f.type ?? '').startsWith('image/') || IMAGE_EXTS.has(extOf(f.name))

type DropTarget = {
  q: number
  r: number
  occupied: boolean
  label: string | null
  index: number
  hasImage: boolean
}

type Scope = 'tile' | 'selection' | 'all'
type OpenSpec = { scope: Scope; labels: string[]; title: string }

type StoreLike = { putResource(blob: Blob): Promise<string> }
type LineageLike = { explorerSegments?: () => readonly string[] }
type DropboxLike = { active(): boolean; accepts(file: { name: string; type?: string }): boolean }

const lastOf = (a: readonly string[]): string => (a.length ? a[a.length - 1] : '')

export class FileDropDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'files'

  public override description =
    'Attaches dropped documents to tiles in a dropbox subtree and serves the file list (tile / selection / all) for the viewer panel.'

  protected override emits = ['files:open']
  protected override listens = ['drop:target', 'render:cell-count', 'tile:action', 'files:open-scope', 'files:remove', 'files:viewer', 'decorations:changed', 'cell:attach-resource']

  /** Last hex position reported by TileOverlayDrone during drag. */
  #lastTarget: DropTarget | null = null
  /** Labels currently in view (for `scope:'all'`). */
  #viewLabels: string[] = []
  /** What the open panel is showing (for live refresh). */
  #open: OpenSpec | null = null
  #effectsRegistered = false

  constructor() {
    super()
    document.addEventListener('dragover', this.#onDragOver)
    document.addEventListener('drop', this.#onDrop)
  }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<DropTarget>('drop:target', (t) => { this.#lastTarget = t })

    this.onEffect<{ labels?: string[] }>('render:cell-count', (p) => {
      this.#viewLabels = Array.isArray(p?.labels) ? p!.labels!.map(String) : []
    })

    // File icon clicked → open the viewer for that single tile.
    this.onEffect<{ action: string; label: string }>('tile:action', (p) => {
      if (p?.action !== 'files' || !p.label) return
      this.#open = { scope: 'tile', labels: [p.label], title: p.label }
      void this.#listAndEmit()
    })

    // /files → aggregate across a selection or the whole view.
    this.onEffect<{ scope: Scope; labels?: string[]; title?: string }>('files:open-scope', (p) => {
      if (!p) return
      if (p.scope === 'selection') {
        const labels = (p.labels ?? []).map(String).filter(Boolean)
        this.#open = { scope: 'selection', labels, title: p.title ?? `${labels.length} selected` }
      } else {
        const labels = this.#viewLabels.filter(l => hasDecorationKind(l, FILES_ATTACHMENT_KIND))
        this.#open = { scope: 'all', labels, title: p.title ?? 'all files' }
      }
      void this.#listAndEmit()
    })

    // Panel asked to detach a file (segments resolved panel-side).
    this.onEffect<{ decorationSig: string; segments: string[] }>('files:remove', (p) => {
      if (!p?.decorationSig || !p.segments) return
      removeAttachment(p.decorationSig, p.segments)
    })

    // Panel closed → stop tracking it.
    this.onEffect<{ active: boolean }>('files:viewer', (p) => {
      if (p && p.active === false) this.#open = null
    })

    // Live refresh: a file was attached/detached on a cell we're showing.
    this.onEffect<{ segments?: readonly string[] }>('decorations:changed', (p) => {
      const open = this.#open
      if (!open || !p?.segments) return
      if (open.labels.includes(lastOf(p.segments))) void this.#listAndEmit()
    })

    // Enter on an armed file drop: the command-line created the cell (and
    // ResourceAttachDrone wrote the dropbox background as its picture) and
    // re-emitted our pending attachment. Write it onto the new cell. Bind
    // the location at handler entry — same lineage the picture landed at.
    this.onEffect<{ cell: string; attachment?: AttachmentPayload | null }>('cell:attach-resource', (p) => {
      if (!p?.cell || !p.attachment) return
      const segments = [...this.#parentSegments(), p.cell]
      void writeAttachment(segments, p.attachment)
    })
  }

  // ── drop handling ─────────────────────────────────────────────

  #onDragOver = (e: DragEvent): void => {
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('Files')) return
    // Allow file drops anywhere on the hive — no `/dropbox` required.
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  #onDrop = (e: DragEvent): void => {
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return

    const list = e.dataTransfer?.files
    if (!list || list.length === 0) return

    // Which dropped files are ours? When a typed dropbox is active, respect
    // its accept filter (it may claim svgs etc.). Otherwise we take any
    // NON-image document — images keep flowing through image-drop.drone.ts
    // as the tile's display picture.
    const dropbox = this.#dropbox
    const active = dropbox?.active() ?? false
    const accepted: File[] = []
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      if (active ? dropbox!.accepts(f) : !isImageFile(f)) accepted.push(f)
    }
    if (accepted.length === 0) return  // not for us — image-drop may take it

    e.preventDefault()
    const target = this.#lastTarget
    if (target?.occupied && target.label) {
      // dropped on an existing tile → attach the file(s) as resources
      const segments = [...this.#parentSegments(), target.label]
      void this.#attachAll(accepted, target.label, segments)
    } else if (accepted.length === 1) {
      // dropped on empty space, one file → arm the command-line with a
      // dropbox background; the user names it and Enter creates the tile
      // (image-before-text flow), with the file attached as a resource.
      void this.#armFileDrop(accepted[0])
    } else {
      // dropped on empty space, several files → auto-name a tile per file
      void this.#createAndAttach(accepted)
    }
  }

  /** Build the `files:attachment` payload for a dropped file (stores bytes). */
  async #toAttachment(file: File): Promise<AttachmentPayload | null> {
    const store = this.#store
    if (!store) return null
    const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
    const sig = await store.putResource(blob)
    return {
      name: file.name || 'file',
      mime: file.type || 'application/octet-stream',
      size: file.size,
      sig,
    }
  }

  /** Empty-space single drop: arm the command-line with the default dropbox
   *  background as the tile picture and hold the file as a pending
   *  attachment. The command-line re-emits it on `cell:attach-resource`
   *  (Enter), which our heartbeat listener writes onto the new cell. */
  async #armFileDrop(file: File): Promise<void> {
    try {
      const attachment = await this.#toAttachment(file)
      if (!attachment) return
      const bg = await dropboxBackgroundBlob(file.name)
      await armImageBlob(bg, { type: 'document', attachment })
    } catch (err) {
      console.warn('[file-drop] arm failed', file?.name, err)
    }
  }

  /** Empty-space multi-file drop: create a tile named from each file, give it
   *  the default dropbox background as its picture, and attach the file as a
   *  resource — so dropping works even on a blank hive. */
  async #createAndAttach(files: File[]): Promise<void> {
    const parent = this.#parentSegments()
    const made: string[] = []
    for (const file of files) {
      const base = (file.name || 'file').replace(/\.[^./\\]+$/, '')
      const name = normalizeCell(base) || normalizeCell(file.name) || 'file'
      try {
        const attachment = await this.#toAttachment(file)
        if (!attachment) continue

        // Lock substrate out until the dropbox picture is written, then create
        // the tile (committer commits membership; show-cell renders + places it).
        EffectBus.emit('cell:attach-pending', { cell: name, pending: true })
        EffectBus.emit('cell:added', { cell: name, segments: parent.slice() })
        await writeAttachment([...parent, name], attachment)

        // Stamp the default dropbox background the same way the armed
        // single-file flow does — ResourceAttachDrone writes the canonical
        // tile properties and releases the substrate lock.
        const bg = await storeImageResources(await dropboxBackgroundBlob(file.name))
        if (bg) {
          EffectBus.emit('cell:attach-resource', {
            cell: name,
            largeSig: bg.largeSig,
            smallPointSig: bg.smallPointSig,
            smallFlatSig: bg.smallFlatSig,
            url: null,
            type: 'document',
            attachment: null,
          })
          try { URL.revokeObjectURL(bg.previewUrl) } catch { /* ignore */ }
        } else {
          EffectBus.emit('cell:attach-pending', { cell: name, pending: false })
        }
        made.push(name)
      } catch (err) {
        console.warn('[file-drop] create+attach failed', file?.name, err)
      }
    }
    if (made.length) {
      EffectBus.emit('activity:log', {
        message: made.length === 1 ? `created "${made[0]}" from ${files[0].name}` : `created ${made.length} tiles from dropped files`,
        icon: '◈',
      })
    }
  }

  async #attachAll(files: File[], label: string, segments: string[]): Promise<void> {
    const store = this.#store
    if (!store) return
    for (const file of files) {
      try {
        const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
        const sig = await store.putResource(blob)
        const payload: AttachmentPayload = {
          name: file.name || 'file',
          mime: file.type || 'application/octet-stream',
          size: file.size,
          sig,
        }
        await writeAttachment(segments, payload)
      } catch (err) {
        console.warn('[file-drop] failed to attach', file?.name, err)
      }
    }
    EffectBus.emit('activity:log', {
      message: files.length === 1 ? `attached "${files[0].name}" to ${label}` : `attached ${files.length} files to ${label}`,
      icon: '◈',
    })
  }

  // ── viewer data ───────────────────────────────────────────────

  async #listAndEmit(): Promise<void> {
    const open = this.#open
    if (!open) return
    const parent = this.#parentSegments()
    const aggregate = open.scope !== 'tile'
    const files: Array<{ name: string; mime: string; size: number; sig: string; decorationSig: string; cell?: string }> = []

    try {
      for (const label of open.labels) {
        const segments = [...parent, label]
        const found = await listAttachments(segments)
        for (const f of found) {
          files.push({
            name: f.payload.name,
            mime: f.payload.mime,
            size: f.payload.size,
            sig: f.payload.sig,        // bytes resource — for download
            decorationSig: f.sig,      // decoration record — for remove
            ...(aggregate ? { cell: label } : {}),
          })
        }
      }
    } catch (err) {
      console.warn('[file-drop] list attachments failed', err)
    }

    // In tile mode `segments` is the tile itself; in aggregate mode it's
    // the common parent and each file carries its own `cell`.
    const segments = aggregate ? parent : [...parent, open.labels[0] ?? '']
    EffectBus.emit('files:open', { cellLabel: open.title, segments, scope: open.scope, files })
  }

  // ── IoC accessors ─────────────────────────────────────────────

  #parentSegments(): string[] {
    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  get #store(): StoreLike | undefined {
    return get('@hypercomb.social/Store') as StoreLike | undefined
  }

  get #dropbox(): DropboxLike | undefined {
    return get('@diamondcoreprocessor.com/DropboxService') as DropboxLike | undefined
  }
}

const _fileDrop = new FileDropDrone()
window.ioc.register('@diamondcoreprocessor.com/FileDropDrone', _fileDrop)
