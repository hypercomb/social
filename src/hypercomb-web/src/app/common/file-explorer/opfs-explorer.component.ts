import { CommonModule } from '@angular/common'
import { AfterViewInit, Component, effect, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { Lineage } from '../../core/lineage'
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
  private readonly lineage = inject(Lineage)

  constructor() {
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
    await this.movement.move(name)
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
    void navigator.clipboard.writeText(e.name)
  }

  public delete = async (e: FileEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    const current = await this.lineage.currentDir()
    if (!current) return

    try {
      await current.removeEntry(e.name, {
        recursive: e.kind === 'directory'
      })

      await this.project()
    } catch (err) {
      console.error('failed to delete entry', e.name, err)
    }
  }

  // --------------------------------------------
  // projection
  // --------------------------------------------

  private readonly project = async (): Promise<void> => {
    const current = await this.lineage.currentDir()
    if (!current) return

    const list: FileEntry[] = []

    for await (const [name, handle] of current.entries()) {
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
