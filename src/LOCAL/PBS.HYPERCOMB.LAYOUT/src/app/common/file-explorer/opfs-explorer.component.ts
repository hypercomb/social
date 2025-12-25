// src/app/common/file-explorer/opfs-explorer.component.ts

import { Component, signal, OnDestroy } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatTableModule } from '@angular/material/table'
import { hypercomb } from '../../hypercomb'

interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemHandle
}

@Component({
  selector: 'hc-opfs-explorer',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatIconModule, MatButtonModule],
  templateUrl: './opfs-explorer.component.html',
  styleUrls: ['./opfs-explorer.component.scss']
})
export class OpfsExplorerComponent extends hypercomb implements OnDestroy {

  public readonly entries = signal<FileEntry[]>([])
  public readonly directory = signal<string>('/')

  private currentDir?: FileSystemDirectoryHandle

  private readonly onSynchronize = (): void => {
    this.project().catch(console.error)
  }

  constructor() {
    super()
    
    // initial projection
    this.project().catch(console.error)

    // listen for the single sync wave
    window.addEventListener('synchronize', this.onSynchronize)
  }

  private readonly project = async (): Promise<void> => {
    const lineage = window.location.pathname.split('/').filter(Boolean)
    this.directory.set('/' + lineage.join('/'))

    const opfsRoot = await navigator.storage.getDirectory()

    const originKey =
      (window.location.host || 'origin')
        .replace(/[^a-z0-9._-]/gi, '_')

    const originDir =
      await opfsRoot.getDirectoryHandle(originKey, { create: true })

    const dir = await this.openDeepestExisting(originDir, lineage)
    this.currentDir = dir

    const list: FileEntry[] = []
    for await (const [name, handle] of dir.entries()) {
      list.push({
        name,
        kind: handle.kind as 'file' | 'directory',
        handle
      })
    }

    list.sort((a, b) => a.name.localeCompare(b.name))
    this.entries.set(list)
  }

  private readonly openDeepestExisting = async (
    root: FileSystemDirectoryHandle,
    lineage: readonly string[]
  ): Promise<FileSystemDirectoryHandle> => {
    let dir = root
    for (const seg of lineage) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        break
      }
    }
    return dir
  }

  public readonly delete = async (
    entry: FileEntry,
    ev: MouseEvent
  ): Promise<void> => {
    ev.stopPropagation()
    if (!this.currentDir) return

    try {
      await this.currentDir.removeEntry(entry.name, {
        recursive: entry.kind === 'directory'
      })
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') throw err
    }

    // re-project after mutation
    await this.project()
  }

  public ngOnDestroy(): void {
    window.removeEventListener('synchronize', this.onSynchronize)
  }
}
