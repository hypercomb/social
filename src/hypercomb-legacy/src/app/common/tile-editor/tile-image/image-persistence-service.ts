// src/app/common/tile-editor/tile-image/image-persistence-service.ts
import { Injectable, inject } from '@angular/core'
import { OpfsImageService } from 'src/app/hive/storage/opfs-image.service'
import { HashService } from 'src/app/hive/storage/hash.service'
import { Cell } from 'src/app/models/cell'

@Injectable({ providedIn: 'root' })
export class ImagePersistenceService {
  private readonly storage = inject(OpfsImageService)

  // save small → sets cell.imageHash
  public saveSmall = async (cell: Cell, blob: Blob): Promise<string> => {
    const name = await this.hashingService.hashName(blob)
    await this.storage.saveSmall(name, blob)
    cell.imageHash = name
    return name
  }

  // save large using same hash
  public saveLarge = async (hash: string, blob: Blob): Promise<void> => {
    await this.storage.saveLarge(hash, blob)
  }

  // move old large → temp
  public moveOldLarge = async (oldHash: string): Promise<void> => {
    if (!oldHash) return
    await this.storage.moveLargeToTemp(oldHash)
  }
}
