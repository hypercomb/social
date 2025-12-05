import { Injectable } from "@angular/core"
import { HiveResolutionType } from "../../hive-models"
import { HiveScout } from "../../hive-scout"
import { HiveResolverBase } from "../hive-resolver.base"

@Injectable({ providedIn: "root" })
export class NewHiveResolver extends HiveResolverBase {
  public override type = HiveResolutionType.NewHive

  public override enabled = async (hiveName: string): Promise<boolean> => {
    throw new Error("Method not implemented.")
  }

  public override async resolve(hiveName: string): Promise<HiveScout> {
    throw new Error("Method not implemented.")
  }
}
