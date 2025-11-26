// src/app/actions/navigation/back.ts
import { inject, Injectable } from "@angular/core"
import { ActionBase } from "../action.base"
import { PointerState } from "src/app/state/input/pointer-state"
import { PayloadBase, hasEvent } from "../action-contexts"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"
import { PanningManager } from "src/app/pixi/panning-manager"   // ⬅️ add this
import { CloseExternalAction } from "./close-external"
import { CarouselService } from "src/app/common/carousel-menu/carousel-service"

@Injectable({ providedIn: "root" })
export class BackHiveAction extends ActionBase<PayloadBase> {
  private readonly pointerstate = inject(PointerState)
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly panning = inject(PanningManager)             // ⬅️ add this
  private readonly carouselsvc = inject(CarouselService)

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
    await this.registry.invoke(CloseExternalAction.ActionId)

    this.panning.getSpacebar().cancelPanSession()
    this.panning.getTouch().cancelPanSession()
    this.state.resetMode()

    // wipe all rendered tiles immediately
    this.combstore.invalidate()

    // wipe hydration state (so new hive loads clean)
    this.hydration.reset()

    // go back
    this.stack.pop()
    
  }

}
