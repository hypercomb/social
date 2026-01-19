// src/app/common/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, effect, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTableModule } from '@angular/material/table'
import { ActIntent, hypercomb } from '@hypercomb/core'
import { Lineage } from '../../core/lineage'
import { MovementService } from '../../core/movment.service'
import { ScriptPreloaderService } from '../../core/script-preloader.service'

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
export class OpfsExplorerComponent extends hypercomb {

  public readonly entries = signal<FileEntry[]>([])
  private readonly lineage = inject(Lineage)
  private readonly movement = inject(MovementService)
  private readonly preloader = inject(ScriptPreloaderService)

  // used to ignore stale async projections if multiple refresh triggers fire quickly
  private projectNonce = 0

  constructor() {
    super()

    effect(() => {
      // refresh and update entries when lineage changes
      this.movement.moved()
      this.lineage.changed()
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
  // actions
  // --------------------------------------------

  public run = async (e: FileEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()
    if (e.kind !== 'file') return

    // marker files are signatures; try to resolve as a known payload and execute it
    // note: this is a test harness. if a signature doesn't map to an action, do nothing.
    const descriptor = this.preloader.resolveBySignature?.(e.name) ?? null
    if (!descriptor) return

    try {
      // if your runtime exposes an "execute by signature" pathway, route it here.
      // otherwise, this no-ops safely.
      const intent: ActIntent | void = await this.act(descriptor.name)
      void intent
    } catch (err) {
      console.error('failed to run entry', e.name, err)
    }
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

      // deletion mutates opfs; bump lineage revision so all listeners stay consistent
      this.lineage.invalidate()
    } catch (err) {
      console.error('failed to delete entry', e.name, err)
    }
  }

  // --------------------------------------------
  // projection
  // --------------------------------------------

  private readonly project = async (): Promise<void> => {
    const nonce = ++this.projectNonce

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

    // ignore stale results if another project started while awaiting
    if (nonce !== this.projectNonce) return

    this.entries.set(list)
  }
}
