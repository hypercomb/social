// actions/back-hive.action.ts
import { inject, Injectable } from "@angular/core"
import { ActionBase } from "../action.base"
import { PointerState } from "src/app/state/input/pointer-state"
import { BaseContext, hasEvent } from "../action-contexts"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"

@Injectable({ providedIn: "root" })
export class BackHiveAction extends ActionBase<BaseContext> {
  private readonly pointerstate = inject(PointerState)
  private readonly hydration = inject(HIVE_HYDRATION)

  public static ActionId = 'hive.back'
  public id = BackHiveAction.ActionId
  public override label = "Back"
  public override description = "Go back to the parent hive or exit clipboard view"

  public override enabled = async (payload: BaseContext): Promise<boolean> => {
    const size = this.stack.size()

    if (hasEvent(payload)) {
      return size > 1
    } else {
      const down = this.pointerstate.rightButtonDown() && size > 1
      return down
    }
  }

  public override run = async (): Promise<void> => {
    this.combstore.invalidate()
    this.hydration.reset()
    this.stack.pop()
    this.menu.hide()
  }
}

