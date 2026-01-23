// src/app/common/file-explorer/opfs-explorer.component.ts
import { CommonModule } from '@angular/common'
import { Component, computed, effect, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { Lineage } from '../../core/lineage'

interface ExplorerEntry {
  name: string
  kind: 'file' | 'directory'
  handle?: FileSystemHandle
}

@Component({
  selector: 'hc-opfs-explorer',
  imports: [CommonModule, MatTableModule, MatIconModule, MatButtonModule],
  standalone: true,
  templateUrl: './opfs-explorer.component.html',
  styleUrls: ['./opfs-explorer.component.scss']
})
export class OpfsExplorerComponent {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly lineage = inject(Lineage)

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  public readonly entries = signal<readonly ExplorerEntry[]>([])

  // virtual path shown in the explorer (domain + current explorer segments)
  public readonly directory = computed<string>(() => {
    this.lineage.changed()
    return this.lineage.explorerLabel()
  })

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    effect(() => {
      this.lineage.changed()
      void this.refresh()
    })
  }

  // -------------------------------------------------
  // navigation (in-memory only)
  // -------------------------------------------------

  public explore = (name: string): void => {
    // clicking ".." moves up without touching the browser address
    if (name === '..') {
      this.lineage.explorerUp()
      return
    }

    // for now: only allow entering directories from the current listing
    const row = this.entries().find(e => e.name === name)
    if (!row || row.kind !== 'directory') return

    // this diverges from the url path and pins explorer automatically
    this.lineage.explorerEnter(name)
  }

  // unchanged hooks used by your template
  public run = (_e: any, ev: MouseEvent): void => { ev.stopPropagation() /* unchanged: your existing run logic */ }
  public copyDetails = (_e: any, ev: MouseEvent): void => { ev.stopPropagation() /* unchanged: your existing copy logic */ }
  public delete = (_e: any, ev: MouseEvent): void => { ev.stopPropagation() /* unchanged: your existing delete logic */ }
  public isSelected = (_e: any): boolean => { return false /* unchanged: your existing selection logic */ }

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

    // parent link so you can browse outside the url path without adding new ui controls
    if (this. lineage.explorerSegments().length > 0) {
      out.push({ name: '..', kind: 'directory' })
    }

    for await (const [name, handle] of dir.entries()) {
      out.push({ name, kind: handle.kind })
    }

    // stable ordering: directories first, then files, alphabetical. keep ".." first.
    out.sort((a, b) => {
      if (a.name === '..') return -1
      if (b.name === '..') return 1
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    this.entries.set(out)
  }
}
