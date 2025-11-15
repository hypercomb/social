import { Injectable, inject } from '@angular/core'
import { EditCell } from 'src/app/cells/cell'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { ImageService } from 'src/app/database/images/image-service'
import { QUERY_COMB_SVC } from 'src/app/shared/tokens/i-comb-query.token'

@Injectable({ providedIn: 'root' })
export class ImagePersistenceService {
  private readonly images = inject(ImageService)
  private readonly query = inject(QUERY_COMB_SVC)

  // hash helper
  private async hashBlob(blob: Blob): Promise<string> {
    const buf = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async imagesEqual(a?: IHiveImage, b?: IHiveImage): Promise<boolean> {
    if (!a || !b) return false
    if (a.x !== b.x || a.y !== b.y || a.scale !== b.scale) return false
    if (a.blob?.size !== b.blob?.size || a.blob?.type !== b.blob?.type) return false

    const [ha, hb] = await Promise.all([
      this.hashBlob(a.blob),
      this.hashBlob(b.blob),
    ])

    return ha === hb
  }

  // ─────────────────────────────────────────────
  // SAVE SMALL (writes to OPFS small/)
  // ─────────────────────────────────────────────
  public async saveSmall(cell: EditCell, blob: Blob): Promise<void> {
    if (!cell) return

    // dedupe check
    if (cell.image && await this.imagesEqual(cell.image, { ...cell.image, blob }))
      return

    // persist to OPFS
    const hash = await this.images.save(blob)

    // update EditCell state
    cell.imageHash = hash
    cell.image = {
      imageHash: hash,
      blob,
      x: cell.image?.x ?? 0,
      y: cell.image?.y ?? 0,
      scale: cell.image?.scale ?? 1,
    }
  }

  // ─────────────────────────────────────────────
  // SAVE LARGE (only during editing)
  // stored as separate OPFS hash, not persisted to cell
  // ─────────────────────────────────────────────
  public async saveLargeIfChanged(cell: EditCell, large: IHiveImage): Promise<void> {
    if (!cell) return

    // dedupe against small
    if (cell.image && await this.imagesEqual(cell.image, large))
      return

    // dedupe against existing large
    const existing = cell.largeImage
    if (existing && await this.imagesEqual(existing, large))
      return

    // persist to OPFS
    const largeHash = await this.images.save(large.blob)

    // store only in working edit state
    cell.largeImage = {
      imageHash: largeHash,
      blob: large.blob,
      x: large.x,
      y: large.y,
      scale: large.scale
    }
  }

  // ─────────────────────────────────────────────
  // delete all working images from EditCell
  // (does not delete from OPFS)
  // ─────────────────────────────────────────────
  public async deleteImages(cell: EditCell): Promise<void> {
    delete cell.originalImage
    delete cell.largeImage
    delete cell.image
    delete cell.imageDirty
    cell.imageHash = undefined
  }

  // ─────────────────────────────────────────────
  // load large image for a persisted cell
  // (rarely used, but kept for safety)
  // ─────────────────────────────────────────────
  public async getExistingLarge(cellId: number): Promise<IHiveImage | null> {
    const cell = await this.query.fetch(cellId)
    if (!cell?.imageHash) return null
    return await this.images.fetch(cell.imageHash) ?? null
  }
}
