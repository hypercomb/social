// hive-resolver-base.ts
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { inject } from "@angular/core"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { IHiveGuide } from "./i-hive-resolver"

export abstract class HiveResolverBase implements IHiveGuide {
  protected readonly debug = inject(DebugService)
  public abstract type: HiveResolutionType

  public abstract enabled(hiveName: string): Promise<boolean> | boolean
  public abstract resolve(hiveName: string): Promise<HiveScout | null> | HiveScout | null

  protected logResolution(msg: string, ...args: any[]) {
    this.debug.log('name-resolution', msg, ...args)
  }
}
