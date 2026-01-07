// actions/toggle-edit-mode.action.ts
import { inject, Injectable } from "@angular/core"
import { ActionContext } from "./action-contexts"
import { Action } from "./action-models"
import { ActionBase } from "./action.base"
import { EventDispatcher } from "../helper/events/event-dispatcher"
import { Events } from "../helper/events/events"

@Injectable({ providedIn: "root" })
export class GlobalEscapeAction extends ActionBase<ActionContext> implements Action<ActionContext> {
    private readonly dispatch = inject(EventDispatcher)

  public id = "global.escape"

  public override enabled = async (_: ActionContext): Promise<boolean> => true

  public run = async (_: ActionContext) => {
    this.dispatch.cancelEvent(Events.EscapeCancel)
  }
}
