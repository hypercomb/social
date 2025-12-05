import { Injectable } from "@angular/core"
import { HiveResolutionType } from "../../hive-models"
import { HiveScout } from "../../hive-scout"
import { HiveResolverBase } from "../hive-resolver.base"

@Injectable({ providedIn: "root" })
export class NewHiveResolver extends HiveResolverBase {
  public override type = HiveResolutionType.New

  public override enabled = async (hiveName: string): Promise<boolean> => {
    // always allow the user to create a new hive
    return true
  }

  public override async resolve(hiveName: string): Promise<HiveScout> {
    const scout = HiveScout.new(hiveName)
    this.debug.log('name-resolution', `Local hive resolved ${hiveName}`)
    return scout
  }
}
