import { Injectable } from "@angular/core";
import { CellContext } from "src/app/actions/action-contexts"; // or BranchContext if you have it
import { ActionBase } from "../action.base";

@Injectable({ providedIn: "root" })
export class BranchAction extends ActionBase<CellContext> {
  
  public static ActionId = "tile.branch"
  public id = BranchAction.ActionId

  public override label = "Set Branch"

  public override enabled = async (payload: CellContext): Promise<boolean> => {
    return payload.cell.isBranch &&  !this.state.cancelled()
  }

  public override run = async (payload: CellContext) => {
    payload.event?.stopPropagation()
    payload.event?.preventDefault()
    this.combstore.invalidate()
    this.stack.push(payload.cell!)
    this.navigation.cancelled = true
    setTimeout(() => this.menu.hide(), 10)
  }
}
