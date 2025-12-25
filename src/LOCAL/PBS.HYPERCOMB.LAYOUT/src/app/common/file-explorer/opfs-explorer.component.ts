// src/app/common/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, OnDestroy, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { hypercomb } from '../../hypercomb'
import { OpfsManager } from '../../core/opfs.manager'

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

  private readonly opfs = inject(OpfsManager)
  private readonly rootPromise = this.opfs.root()

  private currentDir?: FileSystemDirectoryHandle

  // stable handler refs so removeeventlistener works
  private readonly onSynchronize = (): void => { void this.project() }
  private readonly onPopState = (): void => { void this.project() }

  constructor() {
    super()

    // initial projection
    void this.project()

    // listen for the single sync wave
    window.addEventListener('synchronize', this.onSynchronize)
    window.addEventListener('popstate', this.onPopState)
  }

  private readonly project = async (): Promise<void> => {
    // requested lineage from url
    const lineage = window.location.pathname.split('/').filter(Boolean)
    this.directory.set('/' + lineage.join('/'))

    const opfsRoot = await this.rootPromise

    // open deepest existing dir so explorer never throws on missing segments
    const dir = await this.openDeepestExisting(opfsRoot, lineage)
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
      // walk until the first missing segment, then stop at the deepest existing folder
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch (err) {
        // stop only on notfound; rethrow unexpected errors
        const name = (err as DOMException | undefined)?.name
        if (name === 'NotFoundError') break
        throw err
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
      // ignore if it was already deleted elsewhere
      if ((err as DOMException | undefined)?.name !== 'NotFoundError') throw err
    }

    // re-project after mutation
    await this.project()
  }

  public ngOnDestroy(): void {
    window.removeEventListener('synchronize', this.onSynchronize)
    window.removeEventListener('popstate', this.onPopState)
  }
}
