// src/app/common/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, computed, effect, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { DomainName } from '../../core/domain-name'
import { Lineage } from '../../core/lineage'
import { Store } from '../../core/store'

interface ExplorerEntry {
  name: string
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
export class OpfsExplorerComponent {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly lineage = inject(Lineage)
  private readonly store = inject(Store)

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  public readonly entries = signal<readonly ExplorerEntry[]>([])
  public newName = ''

  public readonly directory = computed(() => {
    this.lineage.changed()
    return this.lineage.explorerLabel()
  })

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    effect(() => {
      this.directory()
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

    // explorer is a pure directory browser
    // never interpret a folder click as a "domain selection"
    this.lineage.explorerEnter(name)
  }

  // -------------------------------------------------
  // create
  // -------------------------------------------------

  public createFolder = async (): Promise<void> => {
    const raw = this.newName.trim()
    if (!raw) return

    // creating at "/" is still your explicit "create new domain" intent
    // because you type it, and DomainName.parse is enforced here
    if (this.directory() === '/') {
      const parsed = DomainName.parse(raw)
      const domain = parsed.folder
      if (!domain) return

      const root = this.store.opfsDirectory()
      const domainDir = await root.getDirectoryHandle(domain, { create: true })

      const handle = await domainDir.getFileHandle('__location__', { create: true })
      const writable = await handle.createWritable()

      try {
        const location = `https://storagehypercomb.blob.core.windows.net/content`
        await writable.write(location)
      } finally {
        await writable.close()
      }

      this.newName = ''
      void this.refresh()
      return
    }

    // normal folder inside the currently explored directory
    const dir = await this.lineage.explorerDir()
    if (!dir) return

    await dir.getDirectoryHandle(raw, { create: true })
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

  // -------------------------------------------------
  // actions
  // -------------------------------------------------

  public run = (_e: any, ev: MouseEvent): void => {
    ev.stopPropagation()
  }

  public copyDetails = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    // directories: name only
    if (e.kind === 'directory') {
      await navigator.clipboard.writeText(e.name)
      return
    }

    // files: attempt to read contents
    try {
      const dir = await this.lineage.explorerDir()
      if (!dir) {
        await navigator.clipboard.writeText(e.name)
        return
      }

      const handle = await dir.getFileHandle(e.name, { create: false })
      const file = await handle.getFile()

      if (file.size === 0) {
        await navigator.clipboard.writeText(e.name)
        return
      }

      const text = await file.text()
      ;(window as any).cliptext = text
      await navigator.clipboard.writeText(text)
    } catch {
      await navigator.clipboard.writeText(e.name)
    }
  }

  public delete = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    await dir.removeEntry(e.name, { recursive: e.kind === 'directory' })
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
      out.push({ name: '..', kind: 'directory' })
    }

    for await (const [name, handle] of dir.entries()) {
      out.push({ name, kind: handle.kind })
    }

    out.sort((a, b) => {
      if (a.name === '..') return -1
      if (b.name === '..') return 1
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    this.entries.set(out)
  }
}
