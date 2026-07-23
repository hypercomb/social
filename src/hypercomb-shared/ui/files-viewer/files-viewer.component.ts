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

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { categorize, typeMeta, TYPE_META, TYPE_ORDER, type FileTypeKey, type FileTypeMeta } from './file-icons'

type FileItem = {
  name: string
  mime: string
  size: number
  sig: string           // bytes resource — for download
  decorationSig: string // decoration record — for remove
  cell?: string         // source tile (aggregate mode only)
  path?: string[]       // absolute segments — set once the gather reaches past this page
}

type Scope = 'tile' | 'selection' | 'all'
/** How wide the gather reaches. Same three, same words, as the pheromone
 *  filter and the feedback panel. The drone owns the walk; this is the
 *  control surface for it. */
type Reach = 'local' | 'children' | 'global'

type StoreLike = { getResource(sig: string): Promise<Blob | null> }

@Component({
  selector: 'hc-files-viewer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './files-viewer.component.html',
  styleUrls: ['./files-viewer.component.scss'],
})
export class FilesViewerComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly title = signal<string>('')
  readonly scope = signal<Scope>('tile')
  readonly reach = signal<Reach>('local')
  readonly files = signal<FileItem[]>([])
  readonly #segments = signal<string[]>([])

  /** The three reaches, in order — same ids and glyphs as everywhere else. */
  readonly scopeOptions: readonly { id: Reach; icon: string }[] = [
    { id: 'local', icon: 'center_focus_strong' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]

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
    this.#cleanups.push(EffectBus.on<{ cellLabel: string; segments: string[]; files: FileItem[]; scope?: Scope; reach?: Reach }>('files:open', (p) => {
      if (!p) return
      // Mutually exclusive with the Features panel — they share the right-side
      // dock, so opening Files closes Features.
      EffectBus.emit('features:viewer-close', {})
      this.title.set(p.cellLabel ?? '')
      this.scope.set(p.scope ?? 'tile')
      // Mirror the reach the gather actually ran at, so opening from a tile
      // icon (always this page) resets the trio instead of leaving it lit.
      this.reach.set(p.reach ?? 'local')
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
    this.reach.set('local')
    this.activeTypes.set(new Set())
    this.#segments.set([])
    EffectBus.emit('files:viewer', { active: false })
  }

  /** Pick a reach. The drone re-walks the layer tree and answers with a fresh
   *  `files:open` — a wider reach is a new gather, not a filter over the list
   *  already on screen, because the files it wants aren't in that list. */
  setReach(id: Reach): void {
    if (this.reach() === id) return
    this.reach.set(id)
    EffectBus.emit('files:reach', { reach: id })
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

  /** Detach a file. A row gathered from beyond this page carries its own
   *  absolute `path` — appending its label to the common parent would name
   *  a tile that isn't there. Otherwise: tile mode is `#segments` itself,
   *  page-wide aggregate is the common parent plus the row's `cell`. */
  remove(file: FileItem): void {
    const segments = file.path?.length
      ? file.path
      : (file.cell ? [...this.#segments(), file.cell] : this.#segments())
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

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-files-viewer',
  owner: '@hypercomb.shared/FilesViewerComponent',
  component: FilesViewerComponent,
  order: 110,
})
