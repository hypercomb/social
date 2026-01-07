// src/app/user-interface/texture/spritesheet-repository.ts
import { Injectable } from '@angular/core'

// minimal OPFS storage -------------------------------------------------------
export interface CachedSpritesheet {
  sheetHash: string
  blob: Blob
  frames: any
}

@Injectable({ providedIn: 'root' })
export class SpritesheetRepository {
  private prefix = 'spritesheet-'

  private getFile = async (hash: string) => {
    const root = await navigator.storage.getDirectory()
    return root.getFileHandle(this.prefix + hash, { create: false }).catch(() => undefined)
  }

  public fetch = async (sheetHash: string): Promise<CachedSpritesheet | undefined> => {
    const fh = await this.getFile(sheetHash)
    if (!fh) return undefined
    const file = await fh.getFile()
    const meta = await this.loadMetadata(sheetHash)
    return { sheetHash, blob: file, frames: meta }
  }

  public save = async (data: CachedSpritesheet) => {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle(this.prefix + data.sheetHash, { create: true })
    const writable = await fh.createWritable()
    await writable.write(data.blob)
    await writable.close()
    await this.saveMetadata(data.sheetHash, data.frames)
  }

  private async saveMetadata(hash: string, frames: any) {
    localStorage.setItem(`frames-${hash}`, JSON.stringify(frames))
  }

  private async loadMetadata(hash: string) {
    return JSON.parse(localStorage.getItem(`frames-${hash}`) || '{}')
  }
}
