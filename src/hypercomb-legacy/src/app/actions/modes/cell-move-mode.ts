// actions/toggle-move-mode.action.ts
import { Injectable } from "@angular/core"
import { HypercombMode } from "src/app/core/models/enumerations"
import { ActionContext } from "../action-contexts"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ToggleMoveModeAction extends ActionBase<ActionContext>  {
  public id = "layout.toggleMoveMode"

  public override enabled = async (_: ActionContext): Promise<boolean> => true

  public run = async (_: ActionContext) => {
    this.state.toggleToolMode(HypercombMode.Move)
  }
}
