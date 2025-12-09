// src/app/hive/storage/hive-normalization.service.ts
import { Injectable, inject } from "@angular/core"
import { BlobService } from "src/app/layout/rendering/blob-service"
import { HashingService } from "src/app/hive/storage/hashing-service"

@Injectable({ providedIn: "root" })
export class HiveNormalizationService {
  private readonly blobsvc = inject(BlobService)
  private readonly hashingService = inject(HashingService)

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
        const blob = this.blobsvc.toBlob(base64)! // set the default menu image
        const hash = await this.hashingService.hashName(blob)

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
