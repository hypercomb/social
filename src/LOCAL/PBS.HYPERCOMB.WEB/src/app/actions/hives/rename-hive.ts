// src/app/actions/hive/rename-hive.action.ts
import { Injectable, inject } from "@angular/core"
import { DatabaseService } from "src/app/database/database-service"
import { RenameHiveContext } from "../action-contexts"
import { ActionBase } from "../action.base"
import { QUERY_COMB_SVC, QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"

@Injectable({ providedIn: "root" })
export class RenameHiveAction extends ActionBase<RenameHiveContext> {
  public id = "hive.rename"

  private readonly ds = inject(DatabaseService)
  private readonly query = {
    cells: inject(QUERY_COMB_SVC),
    hives: inject(QUERY_HIVE_SVC),
  }

  public override enabled = async (_: RenameHiveContext): Promise<boolean> => true

  public run = async (payload: RenameHiveContext) => {
    const { hive, newName } = payload
    if (!hive || !newName) {
      throw new Error("missing hive or newName")
    }

    const includeDeleted = true
    const db = this.ds.db()

    //await db.transaction("rw", this.ds.cell_db()!, this.ds.image_db!, async () => {
      // // update hive table
      // const hives = await this.query.hives.fetchHivesByName(hive.name, includeDeleted)
      // for (const hiveItem of hives) {
      //   hiveItem.name = newName
      //   await this.modify.updateCell(hiveItem)
      // }

      // // update tile data
      // const tiles = await this.query.cells.fetchByHive(hive.name, includeDeleted)
      // for (const t of tiles) {
      //   t.name = newName
      // }
      // await this.modify.bulkPut(tiles)
    //})
  }
}
