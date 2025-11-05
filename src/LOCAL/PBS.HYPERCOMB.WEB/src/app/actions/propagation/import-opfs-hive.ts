// src/app/actions/import-hive-database.action.ts
import { Injectable, inject } from "@angular/core"
import { ActionBase } from "../action.base"
import { DatabaseImportService } from "./import-service"
import { ImportHiveContext } from "../action-contexts"
import { OpfsHiveService } from "src/app/hive/storage/opfs-hive-service"
import { ExportService } from "./export-service"

@Injectable({ providedIn: "root" })
export class ImportOpfsHiveAction extends ActionBase<ImportHiveContext> {
    public static ActionId = "db.import-hive"
    private readonly opfs = inject(OpfsHiveService)
    private readonly importer = inject(DatabaseImportService)
    private readonly exporter = inject(ExportService)

    public id = ImportOpfsHiveAction.ActionId
    public override label = "Import Hive Database"
    public override description = "Load a hive by name from OPFS and import it into the singleton Database"
    public override category = "Destructive"
    public override risk: "danger" = "danger"

    public override run = async (payload: ImportHiveContext): Promise<void> => {
        const hiveName = payload.hive.name
        const start = performance.now()

        try {
            const currentHive = this.stack.hiveName()!
            const loaded = (await this.opfs.loadHive(hiveName))!
            await this.exporter.save(currentHive)
            await this.importer.importDirect(loaded.file!)
            const end = performance.now()
            this.debug.log('import', `${hiveName}' imported in ${(end - start).toFixed(2)} ms`)
        } catch (err) {
            this.debug.log('import', `❌ failed to import hive '${hiveName}':`, err)
        }
    }
}