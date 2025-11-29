// src/app/hive/storage/image-repository.ts
import { Injectable, inject } from "@angular/core"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { OpfsImageService } from "src/app/hive/storage/opfs-image.service"


@Injectable({ providedIn: "root" })
export class ImageRepository {

  private readonly opfs = inject(OpfsImageService)
  private readonly debug = inject(DebugService)
  private count = 0 // diagnostics only

  // ───────────────────────────────────────────────
  // FETCH A SINGLE IMAGE BY HASH
  // ───────────────────────────────────────────────
  public async fetch(hash: string): Promise<IHiveImage | undefined> {
    if (!hash) return undefined

    const blob = await this.opfs.loadSmall(hash)
    if (!blob) return undefined

    this.count++
    this.debug.log("image", `ImageRepository.fetch called ${this.count} times`)

    return {
      imageHash: hash,
      blob,
      x: 0,
      y: 0,
      scale: 1
    }
  }

  // ───────────────────────────────────────────────
  // FETCH MULTIPLE IMAGES BY HASH ARRAY
  // ───────────────────────────────────────────────
  public async fetchMany(hashes: string[]): Promise<IHiveImage[]> {
    const results: IHiveImage[] = []

    for (const hash of hashes) {
      const blob = await this.opfs.loadSmall(hash)
      if (!blob) continue

      results.push({
        imageHash: hash,
        blob,
        x: 0,
        y: 0,
        scale: 1
      })
    }

    return results
  }

  // ───────────────────────────────────────────────
  // SAVE (INSERT OR REPLACE)
  // Returns: hash (string)
  // ───────────────────────────────────────────────
  public async save(blob: Blob): Promise<string> {
    const hash = await this.opfs.hashName(blob)
    await this.opfs.saveSmall(hash, blob)
    return hash
  }

  // ───────────────────────────────────────────────
  // DELETE IMAGE BY HASH
  // ───────────────────────────────────────────────
  public async delete(hash: string): Promise<void> {
    try {
      const dir = await this.opfs.smallDir()
      await dir.removeEntry(hash)
    } catch {
      // missing is fine
    }
  }
}
