import { Injectable, inject } from "@angular/core"
import { HIVE_STATE } from "src/app/shared/tokens/i-hive-store.token"
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase, IHiveLoader } from "./i-data-resolver"
import { DatabaseImportService } from "src/app/actions/propagation/import-service"

@Injectable({ providedIn: "root" })
export class FirstOpfsLoader extends HiveLoaderBase implements IHiveLoader {
    private readonly hivestate = inject(HIVE_STATE)
    private readonly importer = inject(DatabaseImportService)

    public enabled(scout: HiveScout): boolean {
        // Only enable if database is empty and scout is first hive
        return scout.type === HiveResolutionType.FirstOpfs
    }

    public async load(scout: HiveScout) {
        this.logDataResolution(`EmptyDatabaseLoader loading first hive: ${scout.name}`)
        // Load the first hive into the database
        const first = this.hivestate.first()

        // Navigate to the current hive address
        await this.importer.importByName(first?.name!)

    }
}
