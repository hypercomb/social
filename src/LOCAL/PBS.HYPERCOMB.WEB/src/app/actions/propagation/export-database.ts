import { Injectable, inject } from "@angular/core"
import { ActionBase } from "../action.base"
import { ActionContext } from "../action-contexts"
import { DatabaseExportService } from "./export-service"

@Injectable({ providedIn: "root" })
export class ExportDatabaseAction extends ActionBase<ActionContext> {
    public id = ExportDatabaseAction.ActionId
    public static ActionId = "db.export"
    private readonly exporter = inject(DatabaseExportService)


    public override label = "Export Database"
    public override description = "Export the current hive database to a file"
    public override category = "Utility"
    public override risk: "warning" = "warning"

    public override run = async (_payload: ActionContext): Promise<void> => {
        const hive = this.hivestore.hive()
        if (!hive) {
            console.warn("No active hive to export.")
            return
        }

        await this.exporter.save(hive.hive)
    }

}
