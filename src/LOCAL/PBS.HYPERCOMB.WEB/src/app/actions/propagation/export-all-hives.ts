// src/app/actions/propagation/export-all-hives.action.ts
import { Injectable, inject } from "@angular/core"
import { ActionBase } from "../action.base"
import { ActionContext } from "../action-contexts"
import { OpfsBackupService } from "./opfs-backup.service"


@Injectable({ providedIn: "root" })
export class ExportAllHivesAction extends ActionBase<ActionContext> {
    public static ActionId = "db.export-all"
    public id = ExportAllHivesAction.ActionId
    public override label = "Export All Hives (Full Backup)"
    public override description = "Download all hives + images as one .zip"

    private readonly backup = inject(OpfsBackupService)

    public override run = async (_payload: ActionContext): Promise<void> => {
        const zipBlob = await this.backup.exportAllAsZip()
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-")
        await this.backup.saveBlobWithNativeDialog(zipBlob, `hypercomb_backup_${timestamp}.zip`)
    }
}