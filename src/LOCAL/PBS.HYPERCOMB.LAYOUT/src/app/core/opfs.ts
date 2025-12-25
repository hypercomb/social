// src/app/core/opfs.file-manager.ts

import { Injectable, inject } from '@angular/core'

import { OpfsManager } from './opfs.manager'
import { FileEntry } from './model/lineage'
import { hypercomb } from '../hypercomb'

@Injectable({ providedIn: 'root' })
export class Opfs extends hypercomb {

  private readonly opfs = inject(OpfsManager)

  public readonly directories: FileSystemDirectoryHandle[] = []
  public readonly entries: FileEntry[] = []

  protected override  synchronize = async(): Promise<void> =>{
    const root = await this.opfs.root()
    const result = await this.opfs.openExistingDirs(this.segments())

    this.directories.length = 0
    let dir = root

    for (const seg of result.existing) {
      this.directories.push(dir)
      dir = await dir.getDirectoryHandle(seg, { create: false })
    }

    this.entries.length = 0
    for await (const [name, handle] of result.dir.entries()) {
      this.entries.push({
        name,
        kind: handle.kind as 'file' | 'directory',
        handle
      })
    }

    this.entries.sort((a, b) => a.name.localeCompare(b.name))
  }
}
