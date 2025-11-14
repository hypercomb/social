// src/app/actions/navigation/branch.ts
import { inject, Injectable } from "@angular/core"
import { CellPayload } from "src/app/actions/action-contexts"
import { ActionBase } from "../action.base"
import { EditorService } from "src/app/state/interactivity/editor-service"

@Injectable({ providedIn: "root" })
export class BranchAction extends ActionBase<CellPayload> {
  private readonly es = inject(EditorService)
  public static ActionId = "tile.branch"
  public id = BranchAction.ActionId
  public override label = "Set Branch"

  public override enabled = async (payload: CellPayload): Promise<boolean> => {
    // If context menu / overlay is active, don't trigger branch.
    if (this.state.isContextActive()) return false

    // If last gesture was a pan (threshold crossed), cancelled() will be true
    if (this.state.cancelled()) return false

    // If somehow we're still mid-pan, also bail (defensive)
    if (this.state.panning) return false

    return !!payload.cell.isBranch
  }

  public override run = async (payload: CellPayload) => {
    // Defensive: re-check at execution time (race-safe)
    if (this.state.isContextActive() || this.state.cancelled() || this.state.panning) {
      this.debug.log("BranchAction run suppressed (cancelled/panning/context)")
      return
    }

    this.debug.log("BranchAction run invoked")

    payload.event?.stopPropagation()
    payload.event?.preventDefault()
    this.combstore.invalidate()
    this.stack.push(payload.cell!)
    setTimeout(() => this.menu.hide(), 10)
  }
}
