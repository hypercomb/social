// actions/toggle-move-mode.action.ts
import { Injectable } from "@angular/core"
import { ActionContext, ChangeModeContext } from "../action-contexts"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ChangeModeAction extends ActionBase<ChangeModeContext>  {
    public static readonly ActionId = "layout.changeMode"
    public id = ChangeModeAction.ActionId
    public override label = "Change Mode"
    public override description = "Change the current tool mode"
    public override category = "Mode"
    public override risk: "none" = "none"   

  public override enabled = async (_: ActionContext): Promise<boolean> => true

  public run = async (payload: ChangeModeContext) => {
    this.state.toggleToolMode(payload.mode)
  }
}
