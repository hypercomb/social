// hypercomb-shared/ui/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, signal, type OnDestroy } from '@angular/core'
import { FormsModule } from '@angular/forms'
import type { Lineage } from '../../core/lineage'
import type { Store } from '../../core/store'
import { hypercomb } from '@hypercomb/core'
import type { ScriptPreloader } from '../../core/script-preloader'
import { LocationParser } from '../../core/initializers/location-parser'
import { RuntimeMediator } from '../runtime-mediator'


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
export class OpfsExplorerComponent extends hypercomb {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly SHOW_ALL_KEY = 'opfs-explorer.show-all'
  private static readonly SHOW_ALL_USER_SET_KEY = 'opfs-explorer.show-all.user-set'
  private static readonly LEGACY_SHOW_ALL_KEY = 'opfs-explorer.show-raw'
  private static readonly SHOW_ALL_BOOTSTRAP_V2_KEY = 'opfs-explorer.show-all.bootstrap-v2'
  private static readonly COPY_MAX_BYTES = 250_000
  private static readonly INSTALL_SUFFIX = '-install'
  public domain: string = 'hypercomb.io'

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get lineage(): Lineage { return window.ioc.get('Lineage') as Lineage }
  private get preloader(): ScriptPreloader { return window.ioc.get('ScriptPreloader') as ScriptPreloader }
  private get store(): Store { return window.ioc.get('Store') as Store }

  // note: runtime mediator stays as angular service
  private readonly runtime = new RuntimeMediator()

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  public readonly entries = signal<readonly ExplorerEntry[]>([])
  public newName = ''

  public readonly showAll = signal(this.readInitialShowAll())

  public readonly directory = (): string => this.lineage.explorerLabel()

  private readonly dispatchSynchronize = (source: string): void => {
    window.dispatchEvent(new CustomEvent('synchronize', { detail: { source } }))
  }

  private refreshing = false
  private refreshQueued = false

  private readonly requestRefresh = (): void => {
    if (this.refreshing) {
      this.refreshQueued = true
      return
    }

    this.refreshing = true

    void (async () => {
      try {
        do {
          this.refreshQueued = false
          await this.refresh()
        } while (this.refreshQueued)
      } finally {
        this.refreshing = false
      }
    })()
  }

  private readonly onSynchronize = (): void => {
    this.requestRefresh()
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    super()

    window.addEventListener('synchronize', this.onSynchronize)

    // initial load
    this.requestRefresh()
  }

  public ngOnDestroy(): void {
    window.removeEventListener('synchronize', this.onSynchronize)
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
    this.requestRefresh()
  }

  // -------------------------------------------------
  // navigation
  // -------------------------------------------------

  public explore = (name: string): void => {
    if (name === '..') {
      this.lineage.explorerUp()
      void this.runProcessorForLocation()
      return
    }

    const row = this.entries().find(e => e.name === name)
    if (!row || row.kind !== 'directory') return

    this.lineage.explorerEnter(name)
    void this.runProcessorForLocation()
  }

  private readonly runProcessorForLocation = async (): Promise<void> => {
    const grammar = this.directory()
    await this.act(grammar)
  }

  // -------------------------------------------------
  // actions
  // -------------------------------------------------

  public run = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    // wire this back in when ready
    // if (e.kind !== 'file') return
    // const drone = this.preloader.get(e.name)
    // drone?.encounter(e.name)
  }

  public copyDetails = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()
    if (e.kind !== 'file') return

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    try {
      const handle = await dir.getFileHandle(e.name, { create: false })
      const file = await handle.getFile()

      if (file.size > OpfsExplorerComponent.COPY_MAX_BYTES) {
        const msg = [
          `file too large to copy (${file.size.toLocaleString()} bytes)`,
          `name: ${e.name}`,
          `label: ${e.label}`,
          `last modified: ${new Date(file.lastModified).toISOString()}`
        ].join('\n')

        await this.writeClipboard(msg)
        return
      }

      const text = await file.text()
      await this.writeClipboard(text)
    } catch (err) {
      console.error('[opfs explorer] copy failed', e.name, err)
    }
  }

  public delete = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    await dir.removeEntry(e.name, { recursive: true })
    this.dispatchSynchronize('opfs:delete')
  }

  // -------------------------------------------------
  // refresh
  // -------------------------------------------------

  private readonly refresh = async (): Promise<void> => {
    const pathAtStart = this.lineage.explorerLabel()
    const isStale = (): boolean => this.lineage.explorerLabel() !== pathAtStart

    const dir = await this.lineage.explorerDir()
    if (isStale()) {
      this.refreshQueued = true
      return
    }

    if (!dir) {
      this.entries.set([])
      return
    }

    const out: ExplorerEntry[] = []

    if (this.directory() !== '/') {
      out.push({ name: '..', label: '..', kind: 'directory' })
    }

    for await (const [name, handle] of dir.entries()) {
      if (this.isHiddenEntry(name)) continue

      let label = name

      if (handle.kind === 'file') {
        const resourceLabel = await this.resolveResourceLabel(name)
        if (resourceLabel) {
          label = `${name.slice(0, 16)} - ${resourceLabel}`
        } else {
          const resolved = this.preloader.getActionName(name)
          if (resolved) label = resolved
        }
      }

      out.push({ name, label, kind: handle.kind })
    }

    if (isStale()) {
      this.refreshQueued = true
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

    // domain root create -> sync pipeline
    if (this.directory() === '/') {
      try {
        await this.runtime.sync(LocationParser.parse(raw))
      } catch (e) {
        console.error(e)
        return
      }

      this.newName = ''
      this.dispatchSynchronize('opfs:create-folder')
      return
    }

    // note: implement non-root folder create when you decide the naming rules
    this.newName = ''
    this.dispatchSynchronize('opfs:create-folder')
  }

  public createFile = async (): Promise<void> => {
    const raw = this.newName.trim()
    if (!raw) return

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    const installName = raw.endsWith(OpfsExplorerComponent.INSTALL_SUFFIX) ? raw : `${raw}${OpfsExplorerComponent.INSTALL_SUFFIX}`
    const handle = await dir.getFileHandle(installName, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write('')
    } finally {
      await writable.close()
    }

    this.newName = ''
    this.dispatchSynchronize('opfs:create-file')
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

    const root = this.store.opfsRoot
    const depsDir = await root.getDirectoryHandle('__dependencies__', { create: true })

    const fileHandle = await depsDir.getFileHandle(sig, { create: true })
    const writable = await fileHandle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    this.newName = ''
    this.dispatchSynchronize('opfs:add-dependency')
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private readonly writeClipboard = async (text: string): Promise<void> => {
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

  private readonly isHiddenEntry = (name: string): boolean => {
    if (this.showAll()) return false
    if (name === '__location__') return true
    if (name === '__drones__') return true
    if (name === '__layers__') return true
    if (name === '__dependencies__') return true
    if (name.startsWith('install-')) return true
    if (name.endsWith(OpfsExplorerComponent.INSTALL_SUFFIX)) return true
    return false
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

  private readonly resolveResourceLabel = async (name: string): Promise<string | null> => {
    try {
      const root = this.store.opfsRoot
      const resourcesDir = await root.getDirectoryHandle('__drones__', { create: false })
      const handle = await resourcesDir.getFileHandle(name, { create: false })
      const file = await handle.getFile()
      if (file.size === 0) return null

      const slice = await file.slice(0, 256).text()
      const firstLine = slice.split('\n')[0]?.trim()
      if (!firstLine?.startsWith('// @hypercomb ')) return null

      const jsonText = firstLine.slice('// @hypercomb '.length)
      const meta = JSON.parse(jsonText)

      if (typeof meta.label === 'string' && meta.label.trim()) {
        return `${meta.label} – ${new Date(file.lastModified).toLocaleTimeString()}`
      }
    } catch {
      // ignore
    }

    return null
  }
}