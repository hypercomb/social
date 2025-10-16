import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase } from "./hive-loader.base"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"

@Injectable({ providedIn: "root" })
export class OpfsNameResolver extends HiveLoaderBase {
  private readonly query = inject(QUERY_HIVE_SVC)
  public override type = HiveResolutionType.Opfs

  public override enabled = async (hiveName: string): Promise<boolean> => {
    this.logResolution(`OpfsNameResolver enabled for ${hiveName}`)
    const hive = await this.query.fetchHive()
    // Only enable if a hive exists and the name is different
    const result = !!hive && hive.hive !== hiveName
    this.logResolution(`OpfsNameResolver enabled result for ${hiveName}: ${result}`)
    return result
  }

  public override async resolve(hiveName: string): Promise<HiveScout | null> {
    this.logResolution(`OpfsNameResolver resolving ${hiveName}`)
    return HiveScout.opfs(hiveName)
  }
}
