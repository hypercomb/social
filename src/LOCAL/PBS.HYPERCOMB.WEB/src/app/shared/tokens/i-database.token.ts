import { InjectionToken, Provider } from "@angular/core"
import Dexie, { Table } from "dexie"
import { CellEntity } from "../../database/model/i-tile-entity"
import DBTables from "src/app/core/constants/db-tables"

import { HiveStore } from "src/app/cells/hive/hive-store"
import { IDexieHive } from "src/app/hive/hive-models"

// define tokens
export const CELL_TABLE = new InjectionToken<Table<CellEntity, number>>("CELL_TABLE")
export const IMAGE_TABLE = new InjectionToken<Table<any, any>>("IMAGE_TABLE")

// bundle providers for convenience
export const DATABASE_PROVIDERS: Provider[] = [
  {
    provide: CELL_TABLE,
    useFactory: (store: HiveStore) => {
      const active: IDexieHive | undefined = store.active()
      if (!active?.file) {
        console.warn("⚠️ CELL_TABLE requested before active hive was hydrated")
        const dummy = new Dexie("dummy")
        dummy.version(1).stores({
          [DBTables.Cells]: "++cellId"
        })
        return dummy.table(DBTables.Cells)
      }

      return 
    },
    deps: [HiveStore],
  },
  {
    provide: IMAGE_TABLE,
    useFactory: (store: HiveStore) => {
      const active = store.active()
      if (!active?.file) {
        throw new Error("❌ IMAGE_TABLE requested before active hive was hydrated")
      }
      return []
    },
    deps: [HiveStore],
  },

]
