// actions/show-hive.command.ts
import { Injectable, inject } from "@angular/core"
import { Action } from "../action-models"
import { HoneycombStore } from "src/app/cells/storage/honeycomb-store"
import { HiveService } from "src/app/hive/storage/hive-service"
import { ShowContext } from "../action-contexts"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"

@Injectable({ providedIn: "root" })
export class ShowHiveAction extends Hypercomb implements Action<ShowContext> {
  category?: string | undefined
  risk?: "none" | "danger" | "warning" | undefined
  
  public id = "hive.show"
  private _label = "Show Hive"
  public get label() {
    return this._label
  }
  public set label(value) {
    this._label = value
  }
  public description = "Stage and render a hive into the workspace"

  private readonly combStore = inject(HoneycombStore)
  private readonly hiveService = inject(HiveService)

  public override enabled = async (): Promise<boolean> => {
    // could add checks if hive is valid or already shown
    return true
  }

  public run = async (payload: ShowContext)=> {
    // const hiveName = payload.hive

    // // 1. load cells for hive
    // const cells = await this.hiveService.loadHive(hiveName)

    // // 2. stage into store
    // this.combStore.stageTiles(hiveName, cells)

    // // 3. flush to rendering scheduler
    // const { hot, cold } = this.combStore.flush()
    // // here you’d feed hot/cold into your RenderScheduler service
    // // e.g. renderScheduler.queue(hot)
    throw new Error("Not implemented")

  }
}
