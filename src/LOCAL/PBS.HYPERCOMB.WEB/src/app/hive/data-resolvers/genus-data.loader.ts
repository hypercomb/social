// genus-data-resolver.ts
import { Injectable, inject } from "@angular/core"
import { Hive, NewCell } from "src/app/cells/cell"
import { HiveScout } from "../hive-scout"
import { MODIFY_COMB_SVC } from "src/app/shared/tokens/i-comb-service.token"
import { CellOptions } from "src/app/cells/models/cell-options"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"
import { HiveLoaderBase } from "./i-data-resolver"
import { OpfsHiveService } from "../storage/opfs-hive-service"

@Injectable({ providedIn: "root" })
export class GenusBootstrapper extends HiveLoaderBase {
  private readonly modify = inject(MODIFY_COMB_SVC)
  private readonly opfs = inject(OpfsHiveService)
  public override enabled(scout: HiveScout): boolean {
    return scout.type === 'Genus'
  }
  
  async load(scout: HiveScout) {
    this.logDataResolution(`GenusBootstrapper bootstrapping for ${scout.name}`)
    if (!scout.name) {
      throw new Error("Genus scout must have a name")
    }

    const hasHive = await this.opfs.hasHive(scout.name)
    if (!hasHive) {

      // 1. seed a brand new hive cell
      const newHive = new NewCell({
        name: "welcome",
        hive: scout.name,
        kind: "Hive",

      })
      newHive.options.set(CellOptions.Active)

      // 2. persist hive to database
      const created = (await this.modify.addCell(newHive)) as Hive

      // 3. create the first child cell under that hive
      const firstCell = new NewCell({
        name: "first",
        hive: scout.name,
        kind: "Cell",
        index: 5,
        sourceId: created.cellId
      })
      firstCell.options.set(CellOptions.Active)

      await this.modify.addCell(firstCell)
    }
    this.logDataResolution(`GenusBootstrapper bootstrapped hive: ${scout.name}`)
  }
}
