// actions/focus-mode.action.ts
import { Injectable } from "@angular/core"
import { Assets } from "pixi.js"
import { HypercombMode } from "../../core/models/enumerations"
import { ActionContext } from "../action-contexts"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class FocusModeAction extends ActionBase<ActionContext> {
  public id = "mode.toggleFocused"
  public override enabled = async (_: ActionContext): Promise<boolean> => true

  public run = async (_: ActionContext)=> {
    // clear pixi asset cache so visuals rebuild under focus mode
    Assets.cache.reset()

    // TODO: controller.refresh() if you want a layout refresh

    if (this.state.hasMode(HypercombMode.Focused)) {
      this.state.removeMode(HypercombMode.Focused)
    } else {
      this.state.setMode(HypercombMode.Focused)
    }
  }
}
