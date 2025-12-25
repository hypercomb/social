// src/app/core/opfs.manager.ts

import { Injectable } from '@angular/core'

export interface OpenExistingResult {
  readonly dir: FileSystemDirectoryHandle
  readonly existing: string[]
  readonly missing: string[]
}

@Injectable({ providedIn: 'root' })
export class OpfsManager {

  public root = async (): Promise<FileSystemDirectoryHandle> => {
    return navigator.storage.getDirectory()
  }

  public ensureDirs = async (
    path: readonly string[]
  ): Promise<FileSystemDirectoryHandle> => {
    let dir = await this.root()
    for (const segment of path) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
    return dir
  }

  public openExistingDirs = async (
    path: readonly string[]
  ): Promise<OpenExistingResult> => {
    let dir = await this.root()
    const existing: string[] = []
    const missing: string[] = []

    for (const segment of path  ) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create: false })
        existing.push(segment)
      } catch {
        missing.push(segment)
        break
      }
    }

    return { dir, existing, missing }
  }
}
