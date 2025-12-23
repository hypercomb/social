// src/app/core/opfs.manager.ts
import { Injectable } from "@angular/core"

export interface OpenExistingResult {
  readonly dir: FileSystemDirectoryHandle
  readonly existing: string[]
  readonly missing: string[]
}

@Injectable({ providedIn: "root" })
export class OpfsManager {

  public root = async (): Promise<FileSystemDirectoryHandle> => {
    return await navigator.storage.getDirectory()
  }

  // create only when explicitly asked to (creation is meaning)
  public ensureDirs = async (path: string[]): Promise<FileSystemDirectoryHandle> => {
    let dir = await this.root()
    for (const segment of path) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
    return dir
  }

  // open what exists; do not create meaning by arriving
  public openExistingDirs = async (path: string[]): Promise<OpenExistingResult> => {
    let dir = await this.root()
    const existing: string[] = []
    const missing: string[] = []

    for (const segment of path) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create: false })
        existing.push(segment)
      } catch {
        missing.push(segment)
      }
      if (missing.length) break
    }

    return { dir, existing, missing }
  }

  public writeFile = async (dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<void> => {
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(data)
    await w.close()
  }

  public deleteEntry = async (dir: FileSystemDirectoryHandle, name: string, recursive = false): Promise<void> => {
    await dir.removeEntry(name, { recursive })
  }
}
