import { Injectable, inject } from '@angular/core'
import { EditCell } from 'src/app/cells/cell'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { ImageService } from 'src/app/database/images/image-service'
import { QUERY_COMB_SVC } from 'src/app/shared/tokens/i-comb-query.token'

@Injectable({ providedIn: 'root' })
export class ImagePersistenceService {
  private readonly images = inject(ImageService)
  private readonly query = inject(QUERY_COMB_SVC)

  // ─────────────────────────────────────────────
  // helpers
  // ─────────────────────────────────────────────
  private async hashBlob(blob: Blob): Promise<string> {
    const ab = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', ab)
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  // compare full image including transform and blob hash
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

  private cloneForPersist(image: IHiveImage, cellId: number): IHiveImage {
    const { db, getBlob, ...rest } = image as any
    return { ...rest, cellId }
  }

  // ─────────────────────────────────────────────
  // save small (always allowed, but deduped)
  // ─────────────────────────────────────────────
  public async saveSmall(cell: EditCell, blob: Blob): Promise<void> {
    if (!cell) return

    // skip if same as existing small image
    if (cell.image && await this.imagesEqual(cell.image, { ...cell.image, blob })) return

    // update in-memory model
    if (!cell.image) {
      cell.image = {
        id: undefined,
        cellId: cell.cellId!,
        blob,
        x: 0,
        y: 0,
        scale: 1,
        getBlob() { return Promise.resolve(this.blob) }
      }
    } else {
      cell.image.blob = blob
    }

    const record = this.cloneForPersist(cell.image, cell.cellId!)
    await this.images.save(record, 'small')
  }

  // ─────────────────────────────────────────────
  // save large only if different from small or db
  // ─────────────────────────────────────────────
  public async saveLargeIfChanged(cell: EditCell, largeImage: IHiveImage): Promise<void> {
    if (!cell) return

    // compare vs small
    if (cell.image && await this.imagesEqual(cell.image, largeImage)) return

    // compare vs existing db record
    const existing = await this.images.loadForCell(cell, 'large')
    if (existing && await this.imagesEqual(existing, largeImage)) return

    if (!cell.largeImage) {
      cell.largeImage = {
        id: undefined,
        cellId: cell.cellId!,
        blob: largeImage.blob,
        x: 0,
        y: 0,
        scale: 1,
        getBlob() { return Promise.resolve(this.blob) }
      }
    } 

    const record = this.cloneForPersist(cell.largeImage, cell.cellId!)
    await this.images.save(record, 'large')
  }

  public async deleteImages(cell: EditCell): Promise<void> {
    delete cell!.originalImage
    delete cell!.largeImage
    delete cell.imageDirty
  }

  // ─────────────────────────────────────────────
  // utility lookup (optional)
  // ─────────────────────────────────────────────
  public async getExistingLarge(cellId: number): Promise<IHiveImage | null> {
    const cell = await this.query.fetch(cellId)
    return await this.images.loadForCell(cell!, 'large') ?? null
  }
}
