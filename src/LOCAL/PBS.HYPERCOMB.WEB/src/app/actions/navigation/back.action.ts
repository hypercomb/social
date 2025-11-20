// src/app/actions/navigation/back.ts
import { inject, Injectable } from "@angular/core"
import { ActionBase } from "../action.base"
import { PointerState } from "src/app/state/input/pointer-state"
import { PayloadBase, hasEvent } from "../action-contexts"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"
import { PanningManager } from "src/app/pixi/panning-manager"   // ⬅️ add this
import { CloseExternalAction } from "./close-external"

@Injectable({ providedIn: "root" })
export class BackHiveAction extends ActionBase<PayloadBase> {
  private readonly pointerstate = inject(PointerState)
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly panning = inject(PanningManager)             // ⬅️ add this

  public static ActionId = 'hive.back'
  public id = BackHiveAction.ActionId
  public override label = "Back"
  public override description = "Go back to the parent hive or exit clipboard view"

  public override enabled = async (payload: PayloadBase): Promise<boolean> => {
    const size = this.stack.size()

    if (hasEvent(payload)) {
      return size > 1
    } else {
      const down = this.pointerstate.rightButtonDown() && size > 1
      return down
    }
  }

  public override run = async (): Promise<void> => {
    // 🔹 Ensure no stale pan/spacebar state survives across hives
    this.panning.getSpacebar().cancelPanSession()
    this.panning.getTouch().cancelPanSession()

    this.state.resetMode
    this.combstore.invalidate()
    this.hydration.reset()
    this.stack.pop()
    await this.registry.invoke(CloseExternalAction.ActionId)
  }
}
