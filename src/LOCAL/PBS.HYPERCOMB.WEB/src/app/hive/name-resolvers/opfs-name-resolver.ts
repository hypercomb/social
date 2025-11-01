import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase } from "./hive-loader.base"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"
import { OpfsHiveService } from "../storage/opfs-hive-service"

@Injectable({ providedIn: "root" })
export class OpfsNameResolver extends HiveLoaderBase {
  private readonly opfsHive = inject(OpfsHiveService)
  private readonly query = inject(QUERY_HIVE_SVC)
  public override type = HiveResolutionType.Opfs



  public override enabled = async (hiveName: string): Promise<boolean> => {
    if (!hiveName?.trim()) return false
    const exists = await this.opfsHive.hasHive(hiveName.trim())
    if (!exists) return false
    const hive = await this.query.fetchHive()
    return !!hive && hive.hive !== hiveName.trim()
  }


  public override async resolve(hiveName: string): Promise<HiveScout | null> {
    this.logResolution(`OpfsNameResolver resolving ${hiveName}`)
    return HiveScout.opfs(hiveName)
  }
}
