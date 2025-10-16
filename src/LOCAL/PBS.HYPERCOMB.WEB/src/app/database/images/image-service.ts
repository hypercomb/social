import { Injectable, inject } from "@angular/core"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { Cell } from "src/app/cells/cell"
import { BlobService } from "src/app/hive/rendering/blob-service"
import { IQueryImages, IModifyImages, HIVE_IMG_REPOSITORY } from "src/app/shared/tokens/i-hive-images.token"

@Injectable({ providedIn: "root" })
export class ImageService implements IQueryImages, IModifyImages {
  private readonly repository = inject(HIVE_IMG_REPOSITORY)
  private readonly blobSvc = inject(BlobService)

  public initialize = async () => {
    await this.repository.initialize()
  }

  // fetch hydrated image for a cell
  public async loadForCell(cell: Cell, table: "small" | "large"): Promise<IHiveImage | undefined> {
    let image = await this.repository.fetchByCell(cell.cellId, table)
    if (!image && cell.sourcePath) {
      // fallback: build from sourcePath
      const blob = await this.blobSvc.fetchImageAsBlob(cell.sourcePath)
      if (blob) {
        image = <IHiveImage>{ cellId: cell.cellId, blob, x: 0, y: 0, scale: 1 }
        await this.repository.add(image, table) // save for next time
      }
    }
    return image
  }

  public getBaseImage = async (cell: Cell): Promise<IHiveImage | undefined> => {
    return await this.loadForCell(cell, 'large') || this.loadForCell(cell, 'small')
  }

  // fetch many by cell ids
  public async loadForCells(cellIds: number[], table: "small" | "large"): Promise<IHiveImage[]> {
    return this.repository.fetchByCells(cellIds, table)
  }

  // convenience: placeholder
  public async placeholder(): Promise<Blob> {
    return BlobService.defaultBlob
  }

  // save/update image after user manipulates (drag, zoom, etc.)
  public async save(image: IHiveImage, table: "small" | "large"): Promise<void> {
    await this.repository.add(image, table) // put = add or update
  }

  public add(image: IHiveImage, table: "small" | "large"): Promise<number> {
    return this.repository.add(image, table)
  }

  public fetchByCell(cellId: number, table: "small" | "large"): Promise<IHiveImage | undefined> {
    return this.repository.fetchByCell(cellId, table)
  }

  public fetchByCells(cellIds: number[], table: "small" | "large"): Promise<IHiveImage[]> {
    return this.repository.fetchByCells(cellIds, table)
  }

  public fetchAll(table: "small" | "large"): Promise<IHiveImage[]> {
    return this.repository.fetchAll(table)
  }

  // delete an image
  public async delete(id: number, table: "small" | "large"): Promise<void> {
    return this.repository.delete(id, table)
  }

}
