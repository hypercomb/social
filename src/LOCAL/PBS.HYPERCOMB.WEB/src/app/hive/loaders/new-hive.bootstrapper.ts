// genus-data-resolver.ts
import { Injectable, inject } from "@angular/core"

import { OpfsImageService } from "../storage/opfs-image.service"
import { CellOptions } from "src/app/cells/models/cell-options"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { BlobService } from "src/app/layout/rendering/blob-service"
import { MODIFY_COMB_SVC } from "src/app/shared/tokens/i-honeycomb-service.token"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase } from "./hive-loader.base"
import { HiveService } from "src/app/cells/hive/hive-service"
import { HivePortal } from "src/app/models/hive-portal"

@Injectable({ providedIn: "root" })
export class NewHiveBootstrapper extends HiveLoaderBase {
  private readonly blobs = inject(BlobService)
  private readonly modify = inject(MODIFY_COMB_SVC)
  private readonly opfs = inject(HiveService)
  private readonly images = inject(OpfsImageService)

  public override enabled(scout: HiveScout): boolean {
    return scout.type === "New"
  }

  async load(scout: HiveScout) {
    this.logDataResolution(`NewHiveBootstrapper bootstrapping for ${scout.name}`)

    if (!scout.name) {
      throw new Error("Genus scout must have a name")
    }

    const exists = await this.opfs.hasHive(scout.name)
    if (!exists) {

      // ────────────────────────────────────────────────────────
      // 1. create initial blob + hash + store in OPFS small/
      // ────────────────────────────────────────────────────────
      const blob = await this.blobs.getInitialBlob()
      const imageHash = await this.hashsvc.hashName(blob)
      await this.images.saveSmall(imageHash, blob)

      const image: IHiveImage = {
        imageHash,
        blob,
        scale: 1,
        x: 0,
        y: 0
      }

      // ────────────────────────────────────────────────────────
      // 2. create the hive root cell
      // ────────────────────────────────────────────────────────
      const newHive = new NewCell({
        name: "welcome",
        kind: "HivePortal"
      })
      newHive.options.set(CellOptions.Active)

      const created = await this.modify.addCell(newHive) as HivePortal

      // ────────────────────────────────────────────────────────
      // 3. create first child cell under the hive
      // ────────────────────────────────────────────────────────
      const firstCell = new NewCell({
        name: "first",
        kind: "Cell",
        index: 5,
        sourceId: created.cellId
      })
      firstCell.options.set(CellOptions.Active)

      await this.modify.addCell(firstCell)
    }

    this.logDataResolution(`NewHiveBootstrapper bootstrapped hive: ${scout.name}`)
  }
}
