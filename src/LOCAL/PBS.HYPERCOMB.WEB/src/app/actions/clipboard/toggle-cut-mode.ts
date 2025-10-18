// actions/toggle-cut-mode.action.ts
import { Injectable } from "@angular/core"
import { ActionContext } from "../action-contexts"
import { HypercombMode } from "src/app/core/models/enumerations"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { CommandMixin } from "src/app/unsorted/helper-mixins"
import { Action } from "../action-models"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ToggleCutModeAction extends ActionBase<ActionContext> {
  public id = "layout.toggleCutMode"
  public override enabled = async (_: ActionContext): Promise<boolean> => true

  public run = async (_: ActionContext) => {
    this.state.toggleToolMode(HypercombMode.Cut)
  }
}
