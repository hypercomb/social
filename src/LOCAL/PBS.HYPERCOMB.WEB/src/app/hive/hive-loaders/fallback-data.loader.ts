import { Injectable, inject } from "@angular/core"
import { Location } from "@angular/common"
import { HiveResolutionType, IDexieHive } from "../hive-models"
import { FallbackNameResolver } from "../name-resolvers/fallback-name-resolver"
import { simplify } from "src/app/shared/services/name-simplifier"
import { HiveScout } from "../hive-scout"
import { IHiveLoader, HiveLoaderBase } from "./i-data-resolver"
import { OpfsHiveService } from "../storage/opfs-hive-service"
import { HIVE_CONTROLLER_ST } from "src/app/shared/tokens/i-hive-store.token"
import { DatabaseImportService } from "src/app/actions/propagation/import-service"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"

@Injectable({ providedIn: "root" })
export class FallbackDataResolver extends HiveLoaderBase implements IHiveLoader {
  private readonly controller = inject(HIVE_CONTROLLER_ST)
  private readonly location = inject(Location)
  private readonly importer = inject(DatabaseImportService)
  private readonly opfs = inject(OpfsHiveService)
  private readonly query = inject(QUERY_HIVE_SVC)

  public enabled(scout: HiveScout): boolean {
    this.logDataResolution(`FallbackDataResolver enabled for ${scout.name}`)
    return scout.type === HiveResolutionType.Fallback
  }

  public async load(scout: HiveScout): Promise<IDexieHive | null> {
    this.logDataResolution(`FallbackDataResolver loading for ${scout.name}`)
    let dexieHive = scout.get<IDexieHive>(FallbackNameResolver)!
    const realName = simplify(dexieHive.name)


    this.location.replaceState(`/${realName}`)
    this.logDataResolution(`FallbackDataResolver updated history state to ${realName}`)

    dexieHive = (await this.opfs.loadHive(scout.name))!
    this.controller.replace(dexieHive.name, dexieHive)
    await this.importer.importDirect(dexieHive.file!)

    const hive = await this.query.fetchHive()
    scout.setHive(hive!)

    // already normalized, return the database reference
    this.logDataResolution(`FallbackDataResolver loaded hive: ${scout.name}`)
    return dexieHive
  }
}
