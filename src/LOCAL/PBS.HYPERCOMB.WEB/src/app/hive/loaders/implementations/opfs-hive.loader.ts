// src/app/hive/resolvers/implementations/opfs-hive.resolver.ts
import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../../hive-models"
import { HiveScout } from "../../hive-scout"
import { ExportService } from "src/app/actions/propagation/export-service"
import { DatabaseImportService } from "src/app/actions/propagation/import-service"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-honeycomb-query.token"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-honeycomb-service.token"
import { HIVE_CONTROLLER_ST, HIVE_STATE } from "src/app/shared/tokens/i-hive-store.token"
import { HiveLoaderBase } from "../../loaders/hive-loader.base"
import { OpfsHiveService } from "../../storage/opfs-hive-service"
import { Hive } from "src/app/cells/cell"

@Injectable({ providedIn: "root" })
export class OpfsHiveLoader extends HiveLoaderBase {
    private readonly controller = inject(HIVE_CONTROLLER_ST)
    private readonly state = inject(HIVE_STATE)
    private readonly opfs = inject(OpfsHiveService)
    private readonly query = inject(QUERY_HIVE_SVC)
    protected readonly hydration = inject(HIVE_HYDRATION)
    private readonly importer = inject(DatabaseImportService)
    private readonly exporter = inject(ExportService)


    public enabled(scout: HiveScout): boolean {
        this.logDataResolution(`OpfsHiveLoader enabled for ${scout.name}`)
        return scout.type === HiveResolutionType.Opfs
    }

    public async load(scout: HiveScout): Promise<Hive | undefined> {
        const name = scout.name.trim()

        this.logDataResolution(`OpfsHiveLoader loading for ${name}`)

        const live = this.state.hive()

        // ──────────────────────────────────────────────
        // case 1: already active → return immediately
        // ──────────────────────────────────────────────
        if (live?.hive === name) {
            this.logDataResolution(`OpfsHiveLoader: hive '${name}' already active — skipping load`)
            return live
        }

        // ──────────────────────────────────────────────
        // case 2: switching hives → export old one
        // ──────────────────────────────────────────────
        if (live) {
            await this.exporter.save(live.hive)
        }

        // ──────────────────────────────────────────────
        // full load pipeline for new hive
        // ──────────────────────────────────────────────
        this.hydration.invalidate()

        const dexie = await this.opfs.loadHive(name)
        this.controller.replace(dexie!.name, dexie!)

        await this.importer.importDirect(dexie!.name, dexie!.file!)

        // use root after import
        const hive = await this.query.fetchRoot()
        return hive
    }
}

