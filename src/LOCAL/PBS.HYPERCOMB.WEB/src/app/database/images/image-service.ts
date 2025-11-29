// src/app/hive/storage/image-service.ts
import { Injectable, inject } from "@angular/core"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { Cell } from "src/app/cells/cell"
import { BlobService } from "src/app/hive/rendering/blob-service"
import { ImageRepository } from "../repository/image-repository"


@Injectable({ providedIn: "root" })
export class ImageService {

  private readonly repo = inject(ImageRepository)
  private readonly blobs = inject(BlobService)

  public initialize = async () => {
    // no-op for now; repository has no Dexie
  }

  // ───────────────────────────────────────────────
  // load the image assigned to a cell (using imageHash)
  // ───────────────────────────────────────────────
  public async loadForCell(cell: Cell): Promise<IHiveImage | undefined> {
    const hash = cell.imageHash

    // 1. Try OPFS by hash
    if (hash) {
      const img = await this.repo.fetch(hash)
      if (img) return img
    }

    // 2. Fallback to sourcePath (initial import)
    if (cell.sourcePath) {
      const blob = await this.blobs.fetchImageAsBlob(cell.sourcePath)
      if (blob) {
        const newHash = await this.repo.save(blob)
        cell.imageHash = newHash

        return {
          imageHash: newHash,
          blob,
          x: 0,
          y: 0,
          scale: 1
        }
      }
    }

    return undefined
  }

  // ───────────────────────────────────────────────
  // fallback: always returns a usable blob
  // ───────────────────────────────────────────────
  public async getBaseImage(cell: Cell): Promise<IHiveImage> {
    const loaded = await this.loadForCell(cell)
    if (loaded) return loaded

    // fallback: use default blob (but still hash it!)
    const blob = BlobService.defaultBlob
    const hash = await this.repo.save(blob)

    // assign back to cell so editor + hydration stay consistent
    cell.imageHash = hash

    return {
      imageHash: hash,
      blob,
      x: 0,
      y: 0,
      scale: 1
    }
  }

  // ───────────────────────────────────────────────
  // load many by hashes
  // ───────────────────────────────────────────────
  public async loadForHashes(hashes: string[]): Promise<IHiveImage[]> {
    return this.repo.fetchMany(hashes)
  }

  // ───────────────────────────────────────────────
  // save image → returns hash
  // ───────────────────────────────────────────────
  public async save(blob: Blob): Promise<string> {
    return this.repo.save(blob)
  }

  // passthrough
  public fetch(hash: string): Promise<IHiveImage | undefined> {
    return this.repo.fetch(hash)
  }

  public fetchMany(hashes: string[]): Promise<IHiveImage[]> {
    return this.repo.fetchMany(hashes)
  }

  public delete(hash: string): Promise<void> {
    return this.repo.delete(hash)
  }
}
