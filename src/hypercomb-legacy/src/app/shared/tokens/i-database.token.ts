import { InjectionToken, Provider } from "@angular/core"
import { HiveStore } from "src/app/core/hive/hive-store"

/**
 * Dexie is no longer used for hive storage.
 * These tokens now exist only for API compatibility.
 * They return empty placeholder objects until (if ever)
 * OPFS-backed table abstractions are introduced.
 */

export const CELL_TABLE = new InjectionToken<unknown>("CELL_TABLE")
export const IMAGE_TABLE = new InjectionToken<unknown>("IMAGE_TABLE")

export const DATABASE_PROVIDERS: Provider[] = [
  {
    provide: CELL_TABLE,
    useFactory: (store: HiveStore) => {
      const active = store.active()
      if (!active) {
        console.warn("⚠️ CELL_TABLE requested but no active hive exists")
        return {}
      }
      // no Dexie; OPFS loads are handled elsewhere
      return {}
    },
    deps: [HiveStore],
  },
  {
    provide: IMAGE_TABLE,
    useFactory: (store: HiveStore) => {
      const active = store.active()
      if (!active) {
        throw new Error("❌ IMAGE_TABLE requested but no active hive exists")
      }
      // OPFS image fetches are handled through ImageService, not Dexie
      return {}
    },
    deps: [HiveStore],
  },
]
