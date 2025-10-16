import Dexie from "dexie"
import DBTables from "src/app/core/constants/db-tables"
import { BaseContext } from "../action-contexts"
import { ActionBase } from "../action.base"
import { DatabaseService } from "src/app/database/database-service"
import { inject, Injectable } from "@angular/core"

@Injectable({ providedIn: 'root' })
export class RebuildHierarchyAction extends ActionBase<BaseContext> {
  public static ActionId = "rebuild-hierarchy"
  public override id = RebuildHierarchyAction.ActionId
  public readonly database = inject(DatabaseService)
  
  public override run = async (ctx: BaseContext) => {
    const db = this.database.db()! 

    await db.transaction("rw", [DBTables.Cells, DBTables.Hierarchy], async () => {
      const hierarchy = db.table(DBTables.Hierarchy)
      const cells = db.table(DBTables.Cells)

      await hierarchy.clear()

      const rows = await cells.toArray()
      const projection = rows
        .filter(r => r.cellId != null && r.hive)
        .map(r => ({
          hive: r.hive,
          cellId: r.cellId as number,
          sourceId: r.sourceId ?? null,
        }))

      if (projection.length > 0) {
        await hierarchy.bulkAdd(projection)
      }
    })

    console.debug("[RebuildHierarchyAction] hierarchy table rebuilt")
  }
}
