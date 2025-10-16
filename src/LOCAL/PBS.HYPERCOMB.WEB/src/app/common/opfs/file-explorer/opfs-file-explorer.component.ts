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
  private currentDirHandle?: FileSystemDirectoryHandle
  private readonly dirStack: FileSystemDirectoryHandle[] = []
  private readonly debug = inject(DebugService)

  public async ngOnInit(): Promise<void> {
    await this.loadDirectory()
  }

  // ───────────────────────────────
  // load directory contents
  // ───────────────────────────────
  public async loadDirectory(handle?: FileSystemDirectoryHandle): Promise<void> {
    try {
      const dir = handle ?? (await navigator.storage.getDirectory())
      this.currentDirHandle = dir

      const entries: FileEntry[] = []
      for await (const [name, h] of dir.entries()) {
        entries.push({ name, kind: h.kind, handle: h })
      }

      entries.sort((a, b) => a.name.localeCompare(b.name))
      this.entries.set(entries)
      this.currentPath.set(
        this.dirStack.length === 0 ? '/' : '/' + this.dirStack.map(d => d.name).join('/')
      )
    } catch (err) {
      this.debug.log('opfs-explorer', 'error loading opfs directory:', err)
    }
  }

  // ───────────────────────────────
  // navigation
  // ───────────────────────────────
  public async open(entry: FileEntry): Promise<void> {
    if (entry.kind !== 'directory') return
    const dirHandle = entry.handle as FileSystemDirectoryHandle
    this.dirStack.push(dirHandle)
    await this.loadDirectory(dirHandle)
  }

  public async goBack(): Promise<void> {
    if (this.dirStack.length === 0) return
    this.dirStack.pop()
    const previous = this.dirStack[this.dirStack.length - 1]
    await this.loadDirectory(previous)
  }

  // ───────────────────────────────
  // file operations
  // ───────────────────────────────
  public async viewFile(entry: FileEntry): Promise<void> {
    if (entry.kind !== 'file') return
    const fileHandle = entry.handle as FileSystemFileHandle
    const file = await fileHandle.getFile()
    const text = await file.text()
    alert(`📄 ${entry.name}\n\n${text.substring(0, 500)}${text.length > 500 ? '…' : ''}`)
  }

  public async deleteEntry(entry: FileEntry): Promise<void> {
    if (!this.currentDirHandle) return
    const confirmDelete = confirm(`Delete "${entry.name}"?`)
    if (!confirmDelete) return

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
