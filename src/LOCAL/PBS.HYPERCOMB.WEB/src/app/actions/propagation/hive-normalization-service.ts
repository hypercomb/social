// src/app/hive/storage/hive-normalization.service.ts
import { Injectable, inject } from "@angular/core"
import { BlobService } from "src/app/hive/rendering/blob-service"
import { OpfsImageService } from "src/app/hive/storage/opfs-image.service"

@Injectable({ providedIn: "root" })
export class HiveNormalizationService {
  private readonly blobsvc = inject(BlobService)
  private readonly images = inject(OpfsImageService)

  public async normalize(raw: any): Promise<{
    normalized: any
    smallImages: { hash: string; blob: Blob }[]
  }> {
    const json = structuredClone(raw)
    const rows = json?.data?.data?.[0]?.rows ?? []

    const smallImages: { hash: string; blob: Blob }[] = []

    for (const row of rows) {
      // legacy blobs – only small images exist at import time
      if (!!row.blob) {
        const base64 = row.blob
          const blob =  this.blobsvc.toBlob(base64)! // set the default menu image
        const hash = await this.images.hashName(blob)

        smallImages.push({ hash, blob })

        // store the image hash on the row
        row.imageHash = hash
        delete row.blob
      }

      // make sure the field always exists
      if (!("imageHash" in row)) row.imageHash = null
    }

    return { normalized: json, smallImages }
  }
}
