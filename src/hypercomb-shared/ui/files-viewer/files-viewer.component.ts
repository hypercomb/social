// hypercomb-shared/ui/files-viewer/files-viewer.component.ts
//
// Right-side panel that lists files attached to a tile — or, in aggregate
// mode, across a selection of tiles or the whole view. Opened when a
// tile's file icon is clicked (FileDropDrone answers `tile:action` with
// `files:open`), or by the `/files` command (selection / all).
//
// Shell UI, so it must NOT import essentials. It renders the list from the
// `files:open` payload, derives each file's TYPE locally (file-icons.ts)
// for the per-row badge and the top type-filter bar, downloads via the
// Store (shared/core), and asks the drone to detach via `files:remove`.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { categorize, typeMeta, TYPE_META, TYPE_ORDER, type FileTypeKey, type FileTypeMeta } from './file-icons'

type FileItem = {
  name: string
  mime: string
  size: number
  sig: string           // bytes resource — for download
  decorationSig: string // decoration record — for remove
  cell?: string         // source tile (aggregate mode only)
}

type Scope = 'tile' | 'selection' | 'all'

type StoreLike = { getResource(sig: string): Promise<Blob | null> }

@Component({
  selector: 'hc-files-viewer',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './files-viewer.component.html',
  styleUrls: ['./files-viewer.component.scss'],
})
export class FilesViewerComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly title = signal<string>('')
  readonly scope = signal<Scope>('tile')
  readonly files = signal<FileItem[]>([])
  readonly #segments = signal<string[]>([])

  /** Active type filters — empty means "all". */
  readonly activeTypes = signal<ReadonlySet<FileTypeKey>>(new Set())

  /** Types present in the current list (ordered), with counts. */
  readonly types = computed(() => {
    const counts = new Map<FileTypeKey, number>()
    for (const f of this.files()) {
      const k = categorize(f.name, f.mime)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return TYPE_ORDER
      .filter(k => counts.has(k))
      .map(k => ({ key: k, count: counts.get(k)!, ...TYPE_META[k] }))
  })

  /** Files after applying the active type filters. */
  readonly filtered = computed(() => {
    const active = this.activeTypes()
    const list = this.files()
    if (active.size === 0) return list
    return list.filter(f => active.has(categorize(f.name, f.mime)))
  })

  /** Show the source-tile column when more than one tile is in view. */
  readonly showSource = computed(() => this.scope() !== 'tile')

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<{ cellLabel: string; segments: string[]; files: FileItem[]; scope?: Scope }>('files:open', (p) => {
      if (!p) return
      this.title.set(p.cellLabel ?? '')
      this.scope.set(p.scope ?? 'tile')
      this.#segments.set(p.segments ?? [])
      this.files.set(Array.isArray(p.files) ? p.files : [])
      // Drop filters that no longer apply to the new list.
      const present = new Set(this.files().map(f => categorize(f.name, f.mime)))
      this.activeTypes.update(set => new Set([...set].filter(k => present.has(k))))
      if (!this.visible()) {
        this.visible.set(true)
        EffectBus.emit('files:viewer', { active: true })
      }
    }))

    this.#cleanups.push(EffectBus.on('files:viewer-close', () => {
      if (this.visible()) this.close()
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  close(): void {
    this.visible.set(false)
    this.files.set([])
    this.title.set('')
    this.scope.set('tile')
    this.activeTypes.set(new Set())
    this.#segments.set([])
    EffectBus.emit('files:viewer', { active: false })
  }

  // ── type filters ──────────────────────────────────────

  toggleType(key: FileTypeKey): void {
    this.activeTypes.update(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  clearTypes(): void {
    this.activeTypes.set(new Set())
  }

  isActive(key: FileTypeKey): boolean {
    return this.activeTypes().has(key)
  }

  badge(file: FileItem): FileTypeMeta {
    return typeMeta(file.name, file.mime)
  }

  // ── actions ───────────────────────────────────────────

  /** Fetch the bytes and trigger a browser download. */
  async download(file: FileItem): Promise<void> {
    const store = this.#store
    if (!store) return
    try {
      const blob = await store.getResource(file.sig)
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name || 'file'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.warn('[files-viewer] download failed', err)
    }
  }

  /** Detach a file. In tile mode `#segments` is the tile itself; in
   *  aggregate mode it's the common parent and the row carries its own
   *  source tile, so append `cell`. */
  remove(file: FileItem): void {
    const segments = file.cell ? [...this.#segments(), file.cell] : this.#segments()
    EffectBus.emit('files:remove', { decorationSig: file.decorationSig, segments })
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
  }

  sizeLabel(bytes: number): string {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // ── service resolution ────────────────────────────────
  get #store(): StoreLike | undefined {
    return get('@hypercomb.social/Store') as StoreLike | undefined
  }

  get i18n(): I18nProvider | undefined {
    return get('@hypercomb.social/I18n') as I18nProvider | undefined
  }
}
