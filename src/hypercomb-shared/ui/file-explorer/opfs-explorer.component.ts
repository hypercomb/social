// hypercomb-shared/ui/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, computed, effect, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import type { Lineage } from '../../core/lineage'
import type { Store } from '../../core/store'
import { hypercomb } from '@hypercomb/core'
import type { ScriptPreloader } from '../../core/script-preloader'
import { LocationParser } from '../../core/initializers/location-parser'
import { RuntimeMediator } from '../runtime-mediator'

const { get, register, list } = window.ioc
void list
void register

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
  private static readonly COPY_MAX_BYTES = 250_000
  private static readonly INSTALL_SUFFIX = '-install'

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get lineage(): Lineage { return get('Lineage') as Lineage }
  private get preloader(): ScriptPreloader { return get('ScriptPreloader') as ScriptPreloader }
  private get store(): Store { return get('Store') as Store }

  // note: runtime mediator stays as angular service
  private readonly runtime = new RuntimeMediator()

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  public readonly entries = signal<readonly ExplorerEntry[]>([])
  public newName = ''

  public readonly showAll = signal(
    localStorage.getItem(OpfsExplorerComponent.SHOW_ALL_KEY) === 'true'
  )

  public readonly directory = computed(() => {
    this.lineage.changed()
    return this.lineage.explorerLabel()
  })

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    super()

    // persist showAll
    effect(() => {
      localStorage.setItem(
        OpfsExplorerComponent.SHOW_ALL_KEY,
        String(this.showAll())
      )
    })

    // refresh on navigation or view toggle
    effect(() => {
      this.directory()
      this.showAll()
      void this.refresh()
    })
  }

  // -------------------------------------------------
  // template helpers
  // -------------------------------------------------

  public trackByName = (_: number, e: ExplorerEntry): string => e.name

  public icon = (e: ExplorerEntry): string => {
    if (e.kind === 'directory') return e.name === '..' ? '↩' : '📁'
    return '📄'
  }

  // -------------------------------------------------
  // navigation
  // -------------------------------------------------

  public explore = (name: string): void => {
    if (name === '..') {
      this.lineage.explorerUp()
      return
    }

    const row = this.entries().find(e => e.name === name)
    if (!row || row.kind !== 'directory') return

    this.lineage.explorerEnter(name)
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
    void this.refresh()
  }

  // -------------------------------------------------
  // refresh
  // -------------------------------------------------

  private readonly refresh = async (): Promise<void> => {
    const dir = await this.lineage.explorerDir()
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
      void this.refresh()
      return
    }

    // note: implement non-root folder create when you decide the naming rules
    this.newName = ''
    void this.refresh()
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
    void this.refresh()
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
    void this.refresh()
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
    if (name.startsWith('install-')) return true
    if (name.endsWith(OpfsExplorerComponent.INSTALL_SUFFIX)) return true
    return false
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