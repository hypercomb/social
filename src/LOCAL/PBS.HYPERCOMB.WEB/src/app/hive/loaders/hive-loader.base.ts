import { IDexieHive } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { inject } from "@angular/core"
import { DebugService } from "src/app/core/diagnostics/debug-service"

export interface IHiveLoader {
  enabled(scout: HiveScout): boolean
  load(scout: HiveScout)
}

export abstract class HiveLoaderBase implements IHiveLoader {
  protected readonly debug = inject(DebugService)
  abstract enabled(scout: HiveScout): boolean
  abstract load(scout: HiveScout)

  protected logDataResolution(msg: string, ...args: any[]) {
    this.debug.log('data-resolution', msg, ...args)
  }
}
