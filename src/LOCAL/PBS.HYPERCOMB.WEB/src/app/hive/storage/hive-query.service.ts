import { effect, inject, Injectable } from "@angular/core"
import { HIVE_CONTROLLER_ST } from "src/app/shared/tokens/i-hive-store.token"
import { IDexieHive } from "../hive-models"
import { IQueryHives } from "src/app/shared/tokens/i-comb-query.token"
import { Hive } from "src/app/cells/cell"
import { CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"
import { CELL_REPOSITORY } from "src/app/shared/tokens/i-cell-repository.token"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { OpfsHiveService } from "./opfs-hive-service"


@Injectable({ providedIn: "root" })
export class HiveQueryService implements IQueryHives {
  private readonly opfs = inject(OpfsHiveService)
  private readonly controller = inject(HIVE_CONTROLLER_ST)
  private readonly repository = inject(CELL_REPOSITORY)
  private readonly factory = inject(CELL_FACTORY)
  private readonly debug = inject(DebugService)

  constructor() {
    // auto-hydrate hive list on startup
    effect(async () => {
      try {
        const registry = await this.opfs.getRegistry()
        if (registry.length > 0) {
          const hives = registry.map(r => ({
            name: r.name.replace(/\.json$/, ""),
            file: undefined
          } as IDexieHive))
          this.debug.log("startup", `hydrating from registry: ${hives.length} hives`)
          this.controller.hydrate(hives)
          return
        }

        const hives = await this.opfs.listHives()
        this.debug.log("startup", `hydrating from hives directory: ${hives.length} hives`)
        this.controller.hydrate(hives)
      } catch (err) {
        this.debug.error("startup", "HiveQueryService hydration failed", err)
      }
    })
  }

  // ─────────────────────────────────────────────
  // fetch the current root hive from Dexie
  // ─────────────────────────────────────────────
  public fetchHive = async (): Promise<Hive | undefined> => {
    try {
      const entity = await this.repository.fetchRoot()
      if (!entity) {
        this.debug.warn("startup", "fetchHive: no root found")
        return undefined
      }
      const cell = this.factory.map(entity!)
      this.debug.log("startup", `fetchHive: loaded ${cell.hive}`)
      return cell as Hive
    } catch (err) {
      this.debug.error("startup", "fetchHive failed", err)
      return undefined
    }
  }

  // ─────────────────────────────────────────────
  // read-only queries
  // ─────────────────────────────────────────────
  public async fetchHives(): Promise<IDexieHive[]> {
    try {
      const hives = await this.opfs.listHives()
      this.debug.log("startup", `fetched ${hives.length} hives from OPFS`)
      return hives
    } catch (err) {
      this.debug.error("startup", "fetchHives failed", err)
      return []
    }
  }
}
