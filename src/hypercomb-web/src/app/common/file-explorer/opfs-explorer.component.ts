// src/app/common/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, computed, effect, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { Lineage } from '../../core/lineage'
import { Store } from '../../core/store'
import { hypercomb } from '@hypercomb/core'
import { ScriptPreloader } from '../../core/script-preloader'
import { RuntimeMediator } from '../../core/runtime-mediator.service'
import { LocationParser } from '../../core/initializers/location-parser'

interface ExplorerEntry {
  name: string
  label: string
  kind: 'file' | 'directory'
}

@Component({
  selector: 'hc-opfs-explorer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule
  ],
  templateUrl: './opfs-explorer.component.html',
  styleUrls: ['./opfs-explorer.component.scss']
})
export class OpfsExplorerComponent extends hypercomb {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------  

  private static readonly SHOW_ALL_KEY = 'opfs-explorer.show-all'

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly lineage = inject(Lineage)
  private readonly preloader = inject(ScriptPreloader)
  private readonly store = inject(Store)
  private readonly runtime = inject(RuntimeMediator)
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
    // ev.stopPropagation()
    // if (e.kind !== 'file') return

    // const drone = this.preloader.get(e.name)
    // drone?.encounter(e.name)

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
        // resource payload label takes priority
        const resourceLabel = await this.resolveResourceLabel(name)
        if (resourceLabel) {
          label = `${name.slice(0, 16)} - ${resourceLabel} `
        } else {
          // fallback to preloader resolution
          const resolved = this.preloader.getActionName(name)
          if (resolved) label = resolved
        }
      }



      out.push({
        name,
        label,
        kind: handle.kind
      })
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

  // hypercomb-web/src/app/common/file-explorer/opfs-explorer.component.ts
  // only the changed section

  public createFolder = async (): Promise<void> => {
    const raw = this.newName.trim()
    if (!raw) return

    if (this.directory() === '/') {
      try {
        // await this.installer.install(raw)

        // run the exact same pipeline as boot
        await this.runtime.sync()
      } catch (e) {
        console.error(e)
        return
      }

      this.newName = ''
      void this.refresh()
      return
    }

    this.newName = ''
    void this.refresh()
  }

  public createFile = async (): Promise<void> => {
    const name = this.newName.trim()
    if (!name) return

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    const handle = await dir.getFileHandle(`install-${name}`, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write('')
    } finally {
      await writable.close()
    }

    this.newName = ''
    void this.refresh()
  }


  public createEntry = async (): Promise<void> => {
    const raw = this.newName.trim()
    if (!raw) return

    // root-level: domain + install in one shot
    if (this.directory() === '/') {
      const parsed = LocationParser.parse(raw)
      const domain = parsed.domain
      if (!domain) return

      // extract last path segment (expected b64 / signature)
      const parts = raw.split('/').filter(Boolean)
      const installId = parts[parts.length - 1]
      if (!installId) return

      const root = this.store.opfsRoot

      // create domain folder
      const domainDir = await root.getDirectoryHandle(domain, { create: true })

      // persist original raw value (location / provenance)
      const locationHandle = await domainDir.getFileHandle('__location__', { create: true })
      const locationWritable = await locationHandle.createWritable()
      try {
        await locationWritable.write(raw)
      } finally {
        await locationWritable.close()
      }

      // create install file inside domain
      const installHandle = await domainDir.getFileHandle(`install-${installId}`, { create: true })
      const installWritable = await installHandle.createWritable()
      try {
        await installWritable.write('')
      } finally {
        await installWritable.close()
      }

      this.newName = ''
      void this.refresh()
      return
    }

    // non-root: create install in current directory
    const dir = await this.lineage.explorerDir()
    if (!dir) return

    const handle = await dir.getFileHandle(`install-${raw}`, { create: true })
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

    // fetch from server
    const url = `https://storagehypercomb.blob.core.windows.net/content/__dependencies__/`
    const res = await fetch(`${url}${sig}`)

    if (!res.ok) {
      console.error('failed to fetch dependency', sig)
      return
    }

    const bytes = await res.arrayBuffer()

    // ensure __dependencies__ exists at OPFS root
    const root = this.store.opfsRoot
    const depsDir = await root.getDirectoryHandle('__dependencies__', { create: true })

    // write dependency by signature
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


  // src/app/common/file-explorer/opfs-explorer.component.ts
  // only the changed sections

  // -------------------------------------------------
  // clipboard
  // -------------------------------------------------

  public copyDetails = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    // only files have bytes to copy
    if (e.kind !== 'file') return

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    try {
      const handle = await dir.getFileHandle(e.name, { create: false })
      const file = await handle.getFile()

      // read as text and copy to clipboard
      const text = await file.text()
      console.log(text)

      // optional: quick confirmation for debugging
      console.log('[opfs explorer] copied to clipboard', e.name, text.length)
    } catch (err) {
      console.error('[opfs explorer] copy failed', e.name, err)
    }
  }



  // -------------------------------------------------
  // delete
  // -------------------------------------------------

  public delete = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    await dir.removeEntry(e.name, { recursive: true })
    void this.refresh()
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private readonly isHiddenEntry = (name: string): boolean => {
    if (this.showAll()) return false
    if (name === '__location__') return true
    if (name === '__drones__') return true
    if (name === '__layers__') return true
    if (name.startsWith('install-')) return true
    return false
  }

  private readonly resolveResourceLabel = async (
    name: string
  ): Promise<string | null> => {
    try {
      const root = this.store.opfsRoot
      const resourcesDir = await root.getDirectoryHandle('__drones__', { create: false })
      const handle = await resourcesDir.getFileHandle(name, { create: false })
      const file = await handle.getFile()
      if (file.size === 0) return null

      // read only the first ~256 bytes
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