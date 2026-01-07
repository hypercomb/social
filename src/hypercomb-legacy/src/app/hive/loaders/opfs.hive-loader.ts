import { inject, Injectable } from "@angular/core"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-honeycomb-service.token"
import { HIVE_CONTROLLER_ST, HIVE_STATE } from "src/app/shared/tokens/i-hive-store.token"
import { HivePortal } from "src/app/models/hive-portal"
import { HiveService } from "src/app/core/hive/hive-service"
import { HiveResolutionType } from "../hive-resolution-type"
import { HiveLoaderBase } from "./hive-loader.base"
import { HiveScout } from "../hive-scout"

@Injectable({ providedIn: "root" })
export class OpfsHiveLoader extends HiveLoaderBase {

  private readonly controller = inject(HIVE_CONTROLLER_ST)
  private readonly hivesvc = inject(HiveService)
  private readonly state = inject(HIVE_STATE)
  protected readonly hydration = inject(HIVE_HYDRATION)

  public enabled(scout: HiveScout): boolean {
    return scout.type === HiveResolutionType.Opfs
  }

  public async load(scout: HiveScout): Promise<HivePortal | undefined> {
    const hash = scout.name.trim()
    const active = this.state.hive()

    // hive already active → no reload
    if (active?.name === hash) {
      return active
    }

    // completely clear all hydrated genes, strands, caches
    this.hydration.invalidate()

    // ensure hive directory (does not load anything yet)
    const handles = await this.hivesvc.load(hash)
    if (!handles) {
      console.warn(`[OpfsHiveLoader] missing hive '${hash}'`)
      return undefined
    }

    // update hive metadata in store
    this.controller.replace(hash, { name: hash })

    // core hydration:
    //   - read append-only strands from /genome/
    //   - derive visible set from strand operations
    //   - create Gene objects for all visible genes
    //   - register them in the hive store (no cells yet)
    //   - push the root seed into the context stack
    await this.hivesvc.load(hash)

    // return a simple portal object (hive header)
    return { name: hash }
  }
}
