import { inject } from "@angular/core"

import { HiveService } from "src/app/cells/hive/hive-service"
import { HivePortal } from "src/app/models/hive-portal"
import { HiveResolutionType } from "../hive-resolution-type"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase } from "./hive-loader.base"
import { HashService } from "../storage/hashing-service"

export class NewHiveLoader extends HiveLoaderBase {

  private readonly opfs = inject(HiveService)

  public enabled(scout: HiveScout): boolean {
    return scout.type === HiveResolutionType.New
  }

  public async  load(scout: HiveScout) : Promise<HivePortal | undefined> {
    // ----------------------------------------------------
    // 1. compute the hive ID (genome hash)
    // ----------------------------------------------------
    const text = scout.name.trim()
    const genomeHash = await HashService.hash(text)

    // ----------------------------------------------------
    // 2. create filesystem structure:
    //    /hives/<hash>/genome
    //    /hives/<hash>/cells
    // ----------------------------------------------------
    await this.opfs.create(genomeHash)

    // ----------------------------------------------------
    // 3. return a HiveScout representing this hive
    // ----------------------------------------------------
    return HiveScout.opfs(genomeHash) || undefined
  }
}
