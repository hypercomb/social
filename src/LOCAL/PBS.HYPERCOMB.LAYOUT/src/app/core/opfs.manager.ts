// src/app/core/opfs.manager.ts

import { Injectable } from '@angular/core'

export interface OpenExistingResult {
  readonly dir: FileSystemDirectoryHandle
  readonly existing: string[]
  readonly missing: string[]
}

@Injectable({ providedIn: 'root' })
export class OpfsManager  {

  public root = async (): Promise<FileSystemDirectoryHandle> => {
    return navigator.storage.getDirectory()
  }

  // deterministic folder name (so localhost:4200 becomes localhost_4200)
  public originKey = (): string => {
    const host = window.location.host || 'origin'
    return host.replace(/[^a-z0-9._-]/gi, '_')
  }

  // origin folder inside opfs root (your explorer can safely use this)
  public originDir = async (): Promise<FileSystemDirectoryHandle> => {
    const root = await this.root()
    return root.getDirectoryHandle(this.originKey(), { create: true })
  }

  // ... unchanged: ensureDirs/openExistingDirs still behave exactly as before
  public ensureDirs = async (path: readonly string[]): Promise<FileSystemDirectoryHandle> => {
    let dir = await this.root()
    for (const segment of path) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
    return dir
  }

  public openExistingDirs = async (path: readonly string[]): Promise<OpenExistingResult> => {
    let dir = await this.root()
    const existing: string[] = []
    const missing: string[] = []

    for (const segment of path) {
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
