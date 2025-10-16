import { IHiveImage } from "src/app/core/models/i-hive-image"
import { ImageDatabase } from "../images/image-database"
import { BlobService } from "src/app/hive/rendering/blob-service"

export class HiveImage implements IHiveImage {
  id?: number
  cellId: number = 0
  blob: Blob = BlobService.defaultBlob
  x: number = 0
  y: number = 0
  scale: number = 1
  private db?: ImageDatabase
  private loadedBlob?: Blob

  constructor(props: Omit<IHiveImage, "getBlob">, db?: ImageDatabase) {
    Object.assign(this, props)
    this.db = db
    if (!this.blob) this.blob = BlobService.defaultBlob
  }

  public async getBlob(): Promise<Blob> {
    if (this.blob) return this.blob
    if (this.loadedBlob) return this.loadedBlob

    if (this.db && this.id != null) {
      // now lookup using kind
      const record = await this.db.get(this.id)
      if (record?.blob) {
        this.loadedBlob = record.blob
        this.blob = record.blob
        return this.blob
      }
    }

    return BlobService.defaultBlob
  }
}
