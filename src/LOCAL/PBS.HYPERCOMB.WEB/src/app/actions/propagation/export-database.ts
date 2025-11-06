// src/app/actions/propagation/export-database.ts
import { Injectable, inject } from "@angular/core"
import { ActionBase } from "../action.base"
import { ActionContext } from "../action-contexts"
import { OpfsBackupService } from "./opfs-backup.service"

@Injectable({ providedIn: "root" })
export class ExportDatabaseAction extends ActionBase<ActionContext> {
    public static ActionId = "db.export"
    public id = ExportDatabaseAction.ActionId
    public override label = "Export Hive Backup"
    public override description = "Download current hive + background as .zip"
    public override category = "Utility"

    private readonly backup = inject(OpfsBackupService)

    public override run = async (_payload: ActionContext): Promise<void> => {
        const hive = this.hivestore.hive()
        if (!hive) return

        await this.backup.exportHiveAsZip(`${hive.hive}.json`)
    }
}