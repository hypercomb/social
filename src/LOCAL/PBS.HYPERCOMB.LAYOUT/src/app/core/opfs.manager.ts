import { Injectable } from '@angular/core'
import { Action, ActionManager } from './action-manager'

@Injectable({ providedIn: 'root' })
export class OpfsManager implements ActionManager {

  public root = async (): Promise<FileSystemDirectoryHandle> => {
    return navigator.storage.getDirectory()
  }

  public ensureDirs = async (path: readonly string[]): Promise<FileSystemDirectoryHandle> => {
    let dir = await this.root()
    for (const segment of path) dir = await dir.getDirectoryHandle(segment, { create: true })
    return dir
  }

  public find = async (_name: string): Promise<readonly Action[]> => {
    const lineage = window.location.pathname.split('/').filter(Boolean)
    let dir = await this.root()
    for (const seg of lineage) {
      try { dir = await dir.getDirectoryHandle(seg, { create: false }) }
      catch { return [] }
    }
    const actions: Action[] = []
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue
      actions.push({ name, run: async () => {} })
    }
    return actions
  }

  public openExistingDirs = async (path: readonly string[]) => {
    let dir = await this.root()
    const existing: string[] = []
    const missing: string[] = []
    for (const segment of path) {
      try { dir = await dir.getDirectoryHandle(segment, { create: false }); existing.push(segment) }
      catch { missing.push(segment); break }
    }
    return { dir, existing, missing }
  }
}
