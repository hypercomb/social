// hive-resolver-base.ts
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { IHiveGuide } from "./i-hive-resolver"
import { inject } from "@angular/core"
import { DebugService } from "src/app/core/diagnostics/debug-service"

export abstract class HiveLoaderBase implements IHiveGuide {
  protected readonly debug = inject(DebugService)
  public abstract type: HiveResolutionType

  public abstract enabled(hiveName: string): Promise<boolean> | boolean
  public abstract resolve(hiveName: string): Promise<HiveScout | null> | HiveScout | null

  protected logResolution(msg: string, ...args: any[]) {
    this.debug.log('name-resolution', msg, ...args)
  }
}
