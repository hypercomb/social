import { Injectable, inject } from "@angular/core"
import { IDexieHive, HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase } from "./hive-loader.base"
import { OpfsHiveService } from "../storage/opfs-hive-service"

@Injectable({ providedIn: "root" })
export class FallbackNameResolver extends HiveLoaderBase {
  private readonly opfs = inject(OpfsHiveService)
  private hive: IDexieHive | null = null
  public override readonly type = HiveResolutionType.Fallback

  private readonly isBlank = (s: string | null | undefined): boolean => !s || !s.trim()
  private readonly norm = (s: string): string => s.trim()

  public override enabled = async (hiveName: string): Promise<boolean> => {
    if (this.isBlank(hiveName)) {
      this.logResolution("fallback disabled: empty hive name")
      return false
    }

    const name = this.norm(hiveName)
    this.logResolution(`FallbackNameResolver enabled for ${name}`)

    // returns IDexieHive | null
    this.hive = await this.opfs.getFirstHive()

    const result = !!this.hive
    this.logResolution(
      result
        ? `FallbackNameResolver will use first OPFS hive: ${this.hive!.name}`
        : "FallbackNameResolver disabled: no OPFS hives found"
    )
    return result
  }

  public override resolve = async (hiveName: string): Promise<HiveScout | null> => {
    const name = this.norm(hiveName)
    this.logResolution(`FallbackNameResolver resolving for ${name}`)

    // no checks here because enabled() guarantees a valid hive
    const scout = HiveScout.fallback(this.hive!.name)
    scout.set(FallbackNameResolver, this.hive!)
    this.logResolution(`FallbackNameResolver resolved fallback for ${scout.name}`)
    return scout
  }
}
