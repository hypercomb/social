import { Injectable, inject } from "@angular/core"
import { HierarchyRestorationService } from "src/app/database/hierarchy/data-hierarchy-organizer"
import { QueryService } from "src/app/helper/external-storage/query-service"
import { HiveResolutionType, IDexieHive } from "../hive-models"
import { LOOKUP_HIVES } from "src/app/shared/tokens/i-hive-store.token"
import { HiveScout } from "../hive-scout"
import { CombQueryService } from "src/app/cells/storage/comb-query-service"
import { IHiveLoader, HiveLoaderBase } from "./i-data-resolver"
import { Hive } from "src/app/cells/cell"

@Injectable({ providedIn: "root" })
export class ServerDataResolver extends HiveLoaderBase implements IHiveLoader {
  private readonly restoration = inject(HierarchyRestorationService)
  private readonly queryservice = inject(QueryService)
  private readonly query = inject(CombQueryService)

  private readonly lookup = inject(LOOKUP_HIVES)

  public enabled(scout: HiveScout): boolean {
    this.logDataResolution(`ServerDataResolver enabled for ${scout.name}`)
    return scout.type === HiveResolutionType.Server
  }

  public async load(scout: HiveScout): Promise<Hive> {
    this.logDataResolution(`ServerDataResolver loading for ${scout.name}`)
    const hiveName = scout.name

    // step 1: fetch from server
    const serverData = await this.queryservice.run(hiveName)

    // step 2: restore into local DB
    await this.restoration.restore(hiveName, serverData)

    // step 3: hydrate from DB into store
    const all = await this.query.fetchAll()

    // step 4: re-query the Hive from the local store/factory
    const hive = this.lookup.lookupDexieHive(hiveName) // <- you’d expose this
    if (!hive) {
      throw new Error(`ServerDataResolver: failed to materialize Hive '${hiveName}' after restore`)
    }

    this.logDataResolution(`ServerDataResolver loaded hive: ${hiveName}`)
    return <any>hive
  }

}
