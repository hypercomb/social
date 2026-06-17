// diamondcoreprocessor.com/files/file-drop.drone.ts
//
// The files worker: drop files onto tiles in a dropbox subtree, then list
// / download / detach them behind the tile's file icon — for a single
// tile, a selection of tiles, or the whole view.
//
//   DROP   — when the current view is a dropbox (DropboxService.active())
//            and the dropped file matches its accept filter, save the bytes
//            as a resource (Store.putResource) and attach them to the tile
//            under the cursor (writeAttachment → `files:attachment`
//            decoration). image-drop.drone.ts defers files the dropbox
//            accepts, so e.g. an svg attaches as a document.
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
  protected override listens = ['drop:target', 'render:cell-count', 'tile:action', 'files:open-scope', 'files:remove', 'files:viewer', 'decorations:changed']

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
  }

  // ── drop handling ─────────────────────────────────────────────

  #onDragOver = (e: DragEvent): void => {
    if (!this.#dropbox?.active()) return
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('Files')) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  #onDrop = (e: DragEvent): void => {
    const dropbox = this.#dropbox
    if (!dropbox?.active()) return

    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return

    const list = e.dataTransfer?.files
    if (!list || list.length === 0) return

    const accepted: File[] = []
    for (let i = 0; i < list.length; i++) {
      if (dropbox.accepts(list[i])) accepted.push(list[i])
    }
    if (accepted.length === 0) return  // not for us — image-drop may take it

    e.preventDefault()
    const target = this.#lastTarget
    if (target?.occupied && target.label) {
      // dropped on an existing tile → attach to it
      const segments = [...this.#parentSegments(), target.label]
      void this.#attachAll(accepted, target.label, segments)
    } else {
      // dropped on empty space → make a tile per file and attach to it
      void this.#createAndAttach(accepted)
    }
  }

  /** Empty-space drop: create a new tile named from each file and attach
   *  the file to it — so dropping works even on a blank hive. */
  async #createAndAttach(files: File[]): Promise<void> {
    const store = this.#store
    if (!store) return
    const parent = this.#parentSegments()
    const made: string[] = []
    for (const file of files) {
      const base = (file.name || 'file').replace(/\.[^./\\]+$/, '')
      const name = normalizeCell(base) || normalizeCell(file.name) || 'file'
      try {
        // Create the tile (committer commits membership; show-cell renders + places it).
        EffectBus.emit('cell:added', { cell: name, segments: parent.slice() })
        const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
        const sig = await store.putResource(blob)
        const payload: AttachmentPayload = {
          name: file.name || 'file',
          mime: file.type || 'application/octet-stream',
          size: file.size,
          sig,
        }
        await writeAttachment([...parent, name], payload)
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
