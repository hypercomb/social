// src/app/common/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, effect, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { OpfsStore } from '../../core/opfs.store'
import { MovementService } from '../../core/movment.service'

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
export class OpfsExplorerComponent {

  public readonly entries = signal<FileEntry[]>([])
  private readonly movement = inject(MovementService)
  private readonly opfs = inject(OpfsStore)

  constructor() {
    // reactive chain: rerun whenever movement changes or OPFS directory updates
    effect(() => {
      this.movement.moved()
      void this.project()
    })
  }

  // --------------------------------------------
  // navigation
  // --------------------------------------------

  public explore = async (name: string): Promise<void> => {
    const entry = this.entries().find(e => e.name === name)
    if (!entry || entry.kind !== 'directory') return
    this.movement.move(name)
  }

  public back = (): void => {
    this.movement.back()
  }

  // --------------------------------------------
  // template helpers
  // --------------------------------------------

  public directory = (): string => window.location.pathname || '/'

  public copyDetails = (e: FileEntry, ev: MouseEvent): void => {
    ev.stopPropagation()
    navigator.clipboard.writeText(e.name)
  }

  public delete = (_e: FileEntry, ev: MouseEvent): void => {
    ev.stopPropagation()
    // intentionally empty for now
  }

  // -------------------------------------------------
  // projection
  // -------------------------------------------------

  private readonly project = async (): Promise<void> => {
    const current = this.opfs.current()
    if (!current) return

    const list: FileEntry[] = []
    const entries = current.entries()
    for await (const [name, handle] of entries) {
      list.push({
        name,
        kind: handle.kind as 'file' | 'directory',
        handle
      })
    }

    list.sort((a, b) => a.name.localeCompare(b.name))
    this.entries.set(list)
  }
}
