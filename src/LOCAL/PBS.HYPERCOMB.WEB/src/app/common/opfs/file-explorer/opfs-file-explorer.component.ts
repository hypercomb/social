import { Component, OnInit, signal, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatTableModule } from '@angular/material/table'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { DebugService } from 'src/app/core/diagnostics/debug-service'

interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemHandle
  thumbUrl?: string
}

@Component({
  selector: 'app-opfs-file-explorer',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatIconModule, MatButtonModule],
  templateUrl: './opfs-file-explorer.component.html',
  styleUrls: ['./opfs-file-explorer.component.scss']
})
export class OpfsFileExplorerComponent implements OnInit {
  public readonly entries = signal<FileEntry[]>([])
  public readonly currentPath = signal<string>('/')
  public readonly previewUrl = signal<string | null>(null)

  private currentDirHandle?: FileSystemDirectoryHandle
  private readonly dirStack: FileSystemDirectoryHandle[] = []
  private readonly debug = inject(DebugService)

  public async ngOnInit(): Promise<void> {
    await this.loadDirectory()
  }

  // image detection by extension
  public isImage(name: string): boolean {
    return /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
  }

  // clear old blob urls so we don't leak
  private revokeThumbs(list: FileEntry[]): void {
    for (const e of list) {
      if (e.thumbUrl) {
        URL.revokeObjectURL(e.thumbUrl)
      }
    }
  }

  // load directory contents
  public async loadDirectory(handle?: FileSystemDirectoryHandle): Promise<void> {
    try {
      // clean up old urls
      this.revokeThumbs(this.entries())

      const dir = handle ?? (await navigator.storage.getDirectory())
      this.currentDirHandle = dir

      const list: FileEntry[] = []

      for await (const [name, handleEntry] of dir.entries()) {
        const kind = handleEntry.kind as 'file' | 'directory'
        const entry: FileEntry = { name, kind, handle: handleEntry }

        if (kind === 'file' && this.isImage(name)) {
          try {
            const fh = handleEntry as FileSystemFileHandle
            const file = await fh.getFile()
            entry.thumbUrl = URL.createObjectURL(file)
          } catch (err) {
            this.debug.warn('opfs-explorer', 'failed to create thumbnail', err)
          }
        }

        list.push(entry)
      }

      list.sort((a, b) => a.name.localeCompare(b.name))
      this.entries.set(list)

      this.currentPath.set(
        this.dirStack.length === 0 ? '/' : '/' + this.dirStack.map(d => d.name).join('/')
      )
    } catch (err) {
      this.debug.log('opfs-explorer', 'error loading opfs directory:', err)
    }
  }

  // navigation
  public async open(entry: FileEntry): Promise<void> {
    if (entry.kind !== 'directory') return
    const dir = entry.handle as FileSystemDirectoryHandle
    this.dirStack.push(dir)
    await this.loadDirectory(dir)
  }

  public async goBack(): Promise<void> {
    if (this.dirStack.length === 0) return
    this.dirStack.pop()
    const parent = this.dirStack[this.dirStack.length - 1]
    await this.loadDirectory(parent)
  }

  // fallback view as text (non-image / debugging)
  public async viewFile(entry: FileEntry): Promise<void> {
    if (entry.kind !== 'file') return
    const fh = entry.handle as FileSystemFileHandle
    const file = await fh.getFile()
    const text = await file.text()
    alert(`📄 ${entry.name}\n\n${text.substring(0, 500)}${text.length > 500 ? '…' : ''}`)
  }

  // open overlay preview with fresh blob
  public async openPreview(entry: FileEntry): Promise<void> {
    if (entry.kind !== 'file') return

    try {
      // revoke existing preview url if any
      const existing = this.previewUrl()
      if (existing) URL.revokeObjectURL(existing)

      const fh = entry.handle as FileSystemFileHandle
      const file = await fh.getFile()
      const url = URL.createObjectURL(file)
      this.previewUrl.set(url)
    } catch (err) {
      this.debug.error('opfs-explorer', 'preview failed', err)
      alert('failed to preview file')
    }
  }

  public closePreview(): void {
    const url = this.previewUrl()
    if (url) URL.revokeObjectURL(url)
    this.previewUrl.set(null)
  }

  // delete
  public async deleteEntry(entry: FileEntry): Promise<void> {
    if (!this.currentDirHandle) return
    const ok = confirm(`Delete "${entry.name}"?`)
    if (!ok) return

    try {
      await this.currentDirHandle.removeEntry(entry.name, {
        recursive: entry.kind === 'directory'
      })
      await this.loadDirectory(this.currentDirHandle)
    } catch (err) {
      this.debug.warn('opfs-explorer', 'failed to delete entry', err)
      alert(`❌ Failed to delete ${entry.name}`)
    }
  }

  public async refresh(): Promise<void> {
    await this.loadDirectory(this.currentDirHandle)
  }
}
