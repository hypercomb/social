import { Injectable, inject } from "@angular/core"
import { HiveResolutionType } from "../hive-models"
import { IHiveLoader, HiveLoaderBase } from "./i-data-resolver"
import { HiveScout } from "../hive-scout"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"
import { OpfsHiveService } from "../storage/opfs-hive-service"
import { HIVE_CONTROLLER_ST } from "src/app/shared/tokens/i-hive-store.token"
import { DatabaseImportService } from "src/app/actions/propagation/import-service"
import { ExportService } from "src/app/actions/propagation/export-service"

@Injectable({ providedIn: "root" })
export class OpfsHiveLoader extends HiveLoaderBase implements IHiveLoader {
    private readonly controller = inject(HIVE_CONTROLLER_ST)
    private readonly opfs = inject(OpfsHiveService)
    private readonly query = inject(QUERY_HIVE_SVC)
    protected readonly hydration = inject(HIVE_HYDRATION)
    private readonly importer = inject(DatabaseImportService)
    private readonly exporter = inject(ExportService)
    

    public enabled(scout: HiveScout): boolean {
        this.logDataResolution(`OpfsHiveLoader enabled for ${scout.name}`)
        return scout.type === HiveResolutionType.Opfs
    }

    public async load(scout: HiveScout) {

        this.logDataResolution(`OpfsHiveLoader loading for ${scout.name}`)
        const old = await this.query.fetchHive()
        if (old) await this.exporter.save(old.hive)

        this.hydration.invalidate()
        const dexie = await this.opfs.loadHive(scout.name)
        this.controller.replace(dexie?.name!, dexie!)
        await this.importer.importDirect(dexie?.name!, dexie?.file!)
        
        const hive = await this.query.fetchHive()
        scout.setHive(hive!)
        this.logDataResolution(`OpfsHiveLoader loaded hive: ${scout.name}`)
    }
}