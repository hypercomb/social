import { inject, Injectable } from "@angular/core"
import { ImageDatabase } from "../images/image-database"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { HiveImage } from "./hive-image"
import Dexie from "dexie"
import { IImageRepository } from "src/app/shared/tokens/i-hive-images.token"
import { DebugService } from "src/app/core/diagnostics/debug-service"

@Injectable({ providedIn: "root" })
export class ImageRepository implements IImageRepository {
  private readonly database = inject(ImageDatabase)
  private readonly debug = inject(DebugService)
  private db: Dexie | undefined = undefined

  public initialize = async () => {
    this.db = await this.database.getDb()
  }
  count = 0
  public async fetchByCell(cellId: number, table: "small" | "large"): Promise<IHiveImage | undefined> {

    const db = await this.database.getDb()!
    const record = await db.table(table).where({ cellId }).first()
    this.count++
    this.debug.log('import', `ImageRepository fetchByCell called ${this.count} times`)

    return record ? new HiveImage(record, this.database) : undefined
  }

  public async fetchByCells(cellIds: number[], table: "small" | "large"): Promise<IHiveImage[]> {
    const records = await this.db!.table(table).bulkGet(cellIds)
    return records
      .filter(Boolean)
      .map(r => new HiveImage(r as IHiveImage, this.database))
  }

  public async fetchAll(table: "small" | "large"): Promise<IHiveImage[]> {
    const records = await this.db!.table(table).toArray()
    return records.map(r => new HiveImage(r, this.database))
  }

  public async add(image: IHiveImage, table: "small" | "large"): Promise<number> {
    // assume blob is always provided for now
    if (!image.blob) throw new Error("❌ Cannot add image without blob")
    const db = await this.database.getDb()
    // fetch existing by cellId to handle uniqueness
    const existing = await db!.table(table).where({ cellId: image.cellId }).first()
    if (existing) {
      // update existing record
      image.id = existing.id
      await db!.table(table).put(image)
      return existing.id
    } else {
      // add new
      const added = await db!.table(table).put(image) as number
      return added
    }
  }

  public async delete(id: number, table: "small" | "large"): Promise<void> {
    await this.db!.table(table).delete(id)
  }
}
