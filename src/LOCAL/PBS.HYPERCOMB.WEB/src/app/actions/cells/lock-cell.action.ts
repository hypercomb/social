// lock-cell.action.ts
import { inject, Injectable } from "@angular/core"
import { CellPayload } from "../action-contexts"
import { CellOptions } from "src/app/cells/models/cell-options"
import { ActionBase } from "../action.base"
import { MODIFY_COMB_SVC } from "src/app/shared/tokens/i-comb-service.token"


@Injectable({ providedIn: "root" })
export class LockCellAction extends ActionBase<CellPayload> {
  public static ActionId = "layout.lock"
  public id = LockCellAction.ActionId
  public override label = "Lock Layout"
  public override description = "Lock or unlock the layout"
  public override category = "Editing"
  public override risk: "warning" = "warning"
  
  public override enabled = async (payload: CellPayload): Promise<boolean> => {
    return !!payload.cell
  }

  public run = async (payload: CellPayload): Promise<void> => {
    const cell = this.stack.cell()!
    cell.options.update((options) => options ^ CellOptions.Locked)
    await this.modify.updateCell(cell)
  }
}
