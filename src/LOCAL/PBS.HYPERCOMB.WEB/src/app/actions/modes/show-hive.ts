// actions/show-hive.action.ts
import { Injectable, inject } from "@angular/core"
import { Router } from "@angular/router"
import { HypercombMode } from "../../core/models/enumerations"
import { CellPayload } from "../action-contexts"
import { ActionBase } from "../action.base"
import { CellEditor } from "src/app/common/tile-editor/cell-editor"

@Injectable({ providedIn: "root" })
export class ShowHiveAction extends ActionBase<CellPayload>  {
  public id = "show.hive"
  private readonly manager = inject(CellEditor)
  private readonly router = inject(Router)

  public  override enabled = async (ctx: CellPayload): Promise<boolean> => {
    const link = ctx.cell?.link
    const isMoveMode = this.state.hasMode(HypercombMode.Move)
    return !!ctx.cell && this.state.hasMode(HypercombMode.Normal) && this.manager.isLocalDomain(link) && !isMoveMode
  }

  public  run = async (ctx: CellPayload) => {
    const link = ctx.cell?.link
    if (!link) return 

    const hive = link.replace(window.location.origin, "")
    await this.router.navigate([hive]).then(() => {
      window.location.reload()
    })
  }
}
