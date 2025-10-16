import { Injectable, inject } from "@angular/core"
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { QUERY_COMB_SVC } from "src/app/shared/tokens/i-comb-query.token"
import { HIVE_CONTROLLER_ST } from "src/app/shared/tokens/i-hive-store.token"
import { Hive } from "src/app/cells/cell"
import { CarouselService } from "src/app/common/carousel-menu/carousel-service"
import { IHiveLoader, HiveLoaderBase } from "./i-data-resolver"

@Injectable({ providedIn: "root" })
export class LiveDbDataLoader extends HiveLoaderBase implements IHiveLoader {
    private readonly query = inject(QUERY_COMB_SVC)
    private readonly controller = inject(HIVE_CONTROLLER_ST)
    private readonly carousel = inject(CarouselService)

    public enabled(scout: HiveScout): boolean {
        this.logDataResolution(`LiveDbDataLoader enabled for ${scout.name}`)
        return scout?.type === HiveResolutionType.LiveDb
    }

    public async load(scout: HiveScout) {
        this.logDataResolution(`LiveDbDataLoader loading for ${scout.name}`)
        // already live in database
        const hive = <Hive>await this.query.fetchRoot()
        console.debug('[LiveDbDataLoader] calling setHive', { hive })
        scout.setHive(hive)
        this.logDataResolution(`LiveDbDataLoader loaded hive: ${scout.name}`)
    }
}
