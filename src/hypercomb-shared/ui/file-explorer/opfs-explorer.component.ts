// hypercomb-shared/ui/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, signal, type OnDestroy } from '@angular/core'
import { FormsModule } from '@angular/forms'
import type { Lineage } from '../../core/lineage'
import type { Store } from '../../core/store'
import { computeLineageSig } from '@hypercomb/core'
import type { ScriptPreloader } from '../../core/script-preloader'


interface ExplorerEntry {
  name: string
  label: string
  kind: 'file' | 'directory'
}

@Component({
  selector: 'hc-opfs-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './opfs-explorer.component.html',
  styleUrls: ['./opfs-explorer.component.scss']
})
export class OpfsExplorerComponent implements OnDestroy {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly SHOW_ALL_KEY = 'opfs-explorer.show-all'
  private static readonly SHOW_ALL_USER_SET_KEY = 'opfs-explorer.show-all.user-set'
  private static readonly LEGACY_SHOW_ALL_KEY = 'opfs-explorer.show-raw'
  private static readonly SHOW_ALL_BOOTSTRAP_V2_KEY = 'opfs-explorer.show-all.bootstrap-v2'
  public domain: string = 'hypercomb.io'

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  #lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  #preloader(): ScriptPreloader { return get('@hypercomb.social/ScriptPreloader') as ScriptPreloader }
  #store(): Store { return get('@hypercomb.social/Store') as Store }

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  public readonly entries = signal<readonly ExplorerEntry[]>([])
  public newName = ''

  public readonly showAll = signal(this.readInitialShowAll())

  public readonly directory = (): string => this.#lineage().explorerLabel()

  #refreshing = false
  #refreshQueued = false

  readonly #requestRefresh = (): void => {
    if (this.#refreshing) {
      this.#refreshQueued = true
      return
    }

    this.#refreshing = true

    void (async () => {
      try {
        do {
          this.#refreshQueued = false
          await this.#refresh()
        } while (this.#refreshQueued)
      } finally {
        this.#refreshing = false
      }
    })()
  }

  readonly #onSynchronize = (): void => {
    this.#requestRefresh()
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    window.addEventListener('synchronize', this.#onSynchronize)

    // initial load
    this.#requestRefresh()
  }

  public ngOnDestroy(): void {
    window.removeEventListener('synchronize', this.#onSynchronize)
  }

  // -------------------------------------------------
  // template helpers
  // -------------------------------------------------

  public trackByName = (_: number, e: ExplorerEntry): string => e.name

  public icon = (e: ExplorerEntry): string => {
    if (e.kind === 'directory') return e.name === '..' ? '↩' : '📁'
    return '📄'
  }

  public toggleShowAll = (): void => {
    const next = !this.showAll()
    this.showAll.set(next)
    localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_USER_SET_KEY, '1')
    localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_KEY, String(next))
    this.#requestRefresh()
  }

  // -------------------------------------------------
  // navigation
  // -------------------------------------------------

  public explore = (name: string): void => {
    if (name === '..') {
      this.#lineage().explorerUp()
      this.#requestRefresh()
      return
    }

    const row = this.entries().find(e => e.name === name)
    if (!row || row.kind !== 'directory') return

    this.#lineage().explorerEnter(name)
    this.#requestRefresh()
  }

  // -------------------------------------------------
  // actions
  // -------------------------------------------------

  public run = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()
  }

  public copyDetails = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()
    if (e.kind !== 'file') return

    // resource files — try reading from __resources__/
    const store = this.#store()
    try {
      const blob = await store.getResource(e.name)
      if (!blob) return

      const text = await blob.text()
      await this.#writeClipboard(text)
    } catch (err) {
      console.error('[opfs explorer] copy failed', e.name, err)
    }
  }

  public delete = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()
    if (e.kind !== 'directory') return

    // remove child from current layer via HistoryService
    const historyService = get('@diamondcoreprocessor.com/HistoryService') as any
    if (!historyService) return

    const segments = [...this.#lineage().explorerSegments()]
    await historyService.removeChild(segments, e.name)
    this.#requestRefresh()
  }

  // -------------------------------------------------
  // refresh — reads live cache instead of OPFS folder tree
  // -------------------------------------------------

  readonly #refresh = async (): Promise<void> => {
    const lineage = this.#lineage()
    const store = this.#store()
    const pathAtStart = lineage.explorerLabel()
    const isStale = (): boolean => lineage.explorerLabel() !== pathAtStart

    const segments = [...lineage.explorerSegments()]
    const lineageSig = await computeLineageSig(segments)

    if (isStale()) {
      this.#refreshQueued = true
      return
    }

    const layer = store.getLayer(lineageSig)

    const out: ExplorerEntry[] = []

    if (this.directory() !== '/') {
      out.push({ name: '..', label: '..', kind: 'directory' })
    }

    if (layer) {
      // children → shown as directories
      const childSigs = await store.getListResource(layer.children)
      for (const childSig of childSigs) {
        try {
          const blob = await store.getResource(childSig)
          if (!blob) continue
          const text = await blob.text()
          const childSegments = JSON.parse(text) as string[]
          const name = childSegments[childSegments.length - 1]
          if (name) {
            out.push({ name, label: name, kind: 'directory' })
          }
        } catch { /* skip */ }
      }

      // resources → shown as files (when showAll is on)
      if (this.showAll()) {
        const resourceSigs = await store.getListResource(layer.resources)
        for (const sig of resourceSigs) {
          out.push({ name: sig, label: sig.slice(0, 16) + '...', kind: 'file' })
        }

        const beeSigs = await store.getListResource(layer.bees)
        for (const sig of beeSigs) {
          const preloader = this.#preloader()
          const actionName = preloader.getActionName(sig)
          const label = actionName ? `${sig.slice(0, 16)} - ${actionName}` : sig.slice(0, 16) + '...'
          out.push({ name: sig, label, kind: 'file' })
        }
      }
    }

    if (isStale()) {
      this.#refreshQueued = true
      return
    }

    out.sort((a, b) => {
      if (a.name === '..') return -1
      if (b.name === '..') return 1
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.label.localeCompare(b.label)
    })

    this.entries.set(out)
  }

  // -------------------------------------------------
  // create
  // -------------------------------------------------

  public createFolder = async (): Promise<void> => {
    const raw = this.newName.trim()
    if (!raw) return

    const historyService = get('@diamondcoreprocessor.com/HistoryService') as any
    if (!historyService) return

    const segments = [...this.#lineage().explorerSegments()]
    await historyService.addChild(segments, raw)

    this.newName = ''
    this.#requestRefresh()
  }

  public createFile = async (): Promise<void> => {
    // marker files are no longer used in the layer-based architecture
    this.newName = ''
  }

  public addDependency = async (): Promise<void> => {
    const sig = this.newName.trim()
    if (!sig) return

    const url = `https://storagehypercomb.blob.core.windows.net/content/__dependencies__/`
    const res = await fetch(`${url}${sig}`)

    if (!res.ok) {
      console.error('failed to fetch dependency', sig)
      return
    }

    const bytes = await res.arrayBuffer()

    const root = this.#store().opfsRoot
    const depsDir = await root.getDirectoryHandle('__dependencies__', { create: true })

    const fileHandle = await depsDir.getFileHandle(sig, { create: true })
    const writable = await fileHandle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    this.newName = ''
    this.#requestRefresh()
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  readonly #writeClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      ta.style.top = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try {
        document.execCommand('copy')
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  private readInitialShowAll(): boolean {
    const userSet = localStorage.getItem(OpfsExplorerComponent.SHOW_ALL_USER_SET_KEY)
    if (userSet !== '1') {
      localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_KEY, 'true')
      return true
    }

    const bootstrapped = localStorage.getItem(OpfsExplorerComponent.SHOW_ALL_BOOTSTRAP_V2_KEY)
    if (bootstrapped !== '1') {
      localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_BOOTSTRAP_V2_KEY, '1')
      localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_KEY, 'true')
      return true
    }

    const current = localStorage.getItem(OpfsExplorerComponent.SHOW_ALL_KEY)
    if (current === 'true') return true
    if (current === 'false') return false

    const legacy = localStorage.getItem(OpfsExplorerComponent.LEGACY_SHOW_ALL_KEY)
    if (legacy === 'true') return true
    if (legacy === 'false') return false

    return true
  }
}
