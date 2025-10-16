// actions/toggle-edit-mode.action.ts
import { Injectable, Signal } from "@angular/core"
import { HypercombMode } from "src/app/core/models/enumerations"
import { ActionContext } from "../action-contexts"
import { Action } from "../action-models"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ToggleEditModeAction extends ActionBase<ActionContext> implements Action<ActionContext> {
  
  public id = "layout.toggleEditMode"

  public override enabled = async (_: ActionContext): Promise<boolean> => true

  public run = async (_: ActionContext) => {
    this.state.toggleToolMode(HypercombMode.Move)
  }
}
