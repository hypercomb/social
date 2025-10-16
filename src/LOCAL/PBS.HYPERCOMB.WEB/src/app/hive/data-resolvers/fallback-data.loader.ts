import { Injectable, inject } from "@angular/core"
import { Router } from "@angular/router"
import { HiveResolutionType, IDexieHive } from "../hive-models"
import { FallbackNameResolver } from "../name-resolvers/fallback-name-resolver"
import { simplify } from "src/app/shared/services/name-simplifier"
import { HiveScout } from "../hive-scout"
import { IHiveLoader, HiveLoaderBase } from "./i-data-resolver"

@Injectable({ providedIn: "root" })
export class FallbackDataResolver extends HiveLoaderBase implements IHiveLoader {
  private readonly router = inject(Router)

  public enabled(scout: HiveScout): boolean {
    this.logDataResolution(`FallbackDataResolver enabled for ${scout.name}`)
    return scout.type === HiveResolutionType.Fallback
  }

  public async load(scout: HiveScout): Promise<IDexieHive | null> {
    this.logDataResolution(`FallbackDataResolver loading for ${scout.name}`)
    const hive = scout.get<IDexieHive>(FallbackNameResolver)!
    const realName = simplify(hive.name)
    const current = scout.name.toLowerCase()

    // prevent redirect loops: only navigate if the names differ
    if (current !== realName) {
      await this.router.navigate([realName], { replaceUrl: true })
      return null
    }

    // already normalized, return the database reference
    this.logDataResolution(`FallbackDataResolver loaded hive: ${scout.name}`)
    return hive
  }
}
