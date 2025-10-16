import { Injectable, inject } from "@angular/core"
import { HiveResolutionType, IDexieHive } from "../hive-models"
import { HiveLoaderBase } from "./hive-loader.base"
import { HiveScout } from "../hive-scout"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"

/**
 * Construct a fallback Scout.
 * This should only be called if no other resolver succeeded.
 */
@Injectable({ providedIn: 'root' })
export class FallbackNameResolver extends HiveLoaderBase {
    private hive: IDexieHive | undefined
    public override enabled = async (hiveName: string): Promise<boolean> => {
        this.logResolution(`FallbackNameResolver enabled for ${hiveName}`)
        this.hive = this.store.first() // signal â†’ array of Cell
        const result = !!this.hive
        this.logResolution(`FallbackNameResolver enabled result for ${hiveName}: ${result}`)
        return result
    }
    public override resolve(hiveName: string): Promise<HiveScout | null> | HiveScout | null {                // only trigger if nothing else resolved
        this.logResolution(`FallbackNameResolver resolving for ${hiveName}`)
        const scout = HiveScout.fallback(hiveName)
        scout.set(FallbackNameResolver, this.hive!)
        this.logResolution(`FallbackNameResolver resolved for ${scout.name}`)
        return scout
    }
    public override readonly type = HiveResolutionType.Fallback
    private readonly store = inject(HIVE_STORE)
}


