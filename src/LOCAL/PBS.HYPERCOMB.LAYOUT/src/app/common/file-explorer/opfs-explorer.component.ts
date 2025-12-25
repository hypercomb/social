// src/app/common/file-explorer/opfs-explorer.component.ts

import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ActivatedRoute } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { Subscription } from 'rxjs'
import { DebugService } from '../../core/debug-service'
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
export class OpfsExplorerComponent implements OnInit, OnDestroy {

  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────

  private readonly route = inject(ActivatedRoute)
  private readonly debug = inject(DebugService)
  private readonly processor = inject(hypercomb)
  private readonly opfs = inject(OpfsManager)

  // ─────────────────────────────────────────────
  // reactive state
  // ─────────────────────────────────────────────

  public readonly entries = signal<FileEntry[]>([])
  public readonly previewUrl = signal<string | null>(null)
  public readonly lineage = signal<string[]>([])
  public readonly path = signal<string>('')

  private currentDir?: FileSystemDirectoryHandle
  private sub?: Subscription

  // ─────────────────────────────────────────────
  // lifecycle
  // ─────────────────────────────────────────────

  public ngOnInit(): void {

    this.sub = this.route.url.subscribe( segments => {
      // derive directly from the actual browser URL
      const path = '/' + segments.map(s => s.path).filter(Boolean).join('/')
      const lineage = path.split('/').filter(Boolean)

      // update signals
      this.path.set(path)
      this.lineage.set(lineage)

      // sync filesystem view
       this.syncFromLineage(lineage).catch(err =>
        this.debug.error('opfs-explorer', 'sync failed', err)
      )
    })
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe()
    this.closePreview()
  }

  // ─────────────────────────────────────────────
  // filesystem sync
  // ─────────────────────────────────────────────

  private async syncFromLineage(lineage: string[]): Promise<void> {
    let dir = await navigator.storage.getDirectory()

    for (const seg of lineage) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        break
      }
    }

    this.currentDir = dir
    await this.loadDirectory(dir)
  }

  private async loadDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
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

  // ─────────────────────────────────────────────
  // actions
  // ─────────────────────────────────────────────

  public async open(entry: FileEntry): Promise<void> {
    if (entry.kind !== 'directory') return
    await this.processor.write(entry.name)
  }

  public async delete(entry: FileEntry, ev: MouseEvent): Promise<void> {
    ev.stopPropagation()
    if (!this.currentDir) return

    try {
      await this.currentDir.removeEntry(entry.name, {
        recursive: entry.kind === 'directory'
      })
      await this.loadDirectory(this.currentDir)
    } catch (err) {
      this.debug.error('opfs-explorer', 'delete failed', err)
    }
  }

  public async openPreview(entry: FileEntry): Promise<void> {
    if (entry.kind !== 'file') return

    try {
      const existing = this.previewUrl()
      if (existing) URL.revokeObjectURL(existing)

      const fh = entry.handle as FileSystemFileHandle
      const file = await fh.getFile()
      this.previewUrl.set(URL.createObjectURL(file))
    } catch (err) {
      this.debug.error('opfs-explorer', 'preview failed', err)
    }
  }

  public closePreview(): void {
    const url = this.previewUrl()
    if (url) URL.revokeObjectURL(url)
    this.previewUrl.set(null)
  }
}
  