import { inject, Injectable } from "@angular/core";
import { CellContext } from "src/app/actions/action-contexts"; // or BranchContext if you have it
import { ActionBase } from "../action.base";
import { EditorService } from "src/app/state/interactivity/editor-service";

@Injectable({ providedIn: "root" })
export class BranchAction extends ActionBase<CellContext> {
  private readonly es = inject(EditorService);
  public static ActionId = "tile.branch"
  public id = BranchAction.ActionId
  public override label = "Set Branch"

  public override enabled = async (payload: CellContext): Promise<boolean> => {
    // Skip if panning is active
    if (this.state.panning || this.state.isContextActive()) {
      this.state.panning = false;
      return false;
    }
    
    return payload.cell.isBranch && !this.state.cancelled();
  }

  public override run = async (payload: CellContext) => {
    this.debug.log("BranchAction run invoked")

    payload.event?.stopPropagation()
    payload.event?.preventDefault()
    this.combstore.invalidate()
    this.stack.push(payload.cell!)
    setTimeout(() => this.menu.hide(), 10)
  }
}
