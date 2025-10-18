// actions/show-hive.action.ts
import { Injectable, inject } from "@angular/core"
import { Router } from "@angular/router"
import { HypercombMode } from "../../core/models/enumerations"
import { HexagonEditManager } from "../../layout/hexagons/hexagon-edit-manager"
import { CellContext } from "../action-contexts"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ShowHiveAction extends ActionBase<CellContext>  {
  public id = "show.hive"
  private readonly manager = inject(HexagonEditManager)
  private readonly router = inject(Router)

  public  override enabled = async (ctx: CellContext): Promise<boolean> => {
    const link = ctx.cell?.link
    const isMoveMode = this.state.hasMode(HypercombMode.Move)
    return !!ctx.cell && this.state.hasMode(HypercombMode.Normal) && this.manager.isLocalDomain(link) && !isMoveMode
  }

  public  run = async (ctx: CellContext) => {
    const link = ctx.cell?.link
    if (!link) return 

    const hive = link.replace(window.location.origin, "")
    await this.router.navigate([hive]).then(() => {
      window.location.reload()
    })
  }
}
