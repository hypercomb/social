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
    if (this.state.isContextActive()) return false
    if (this.state.cancelled()) return false
    if (this.state.panning) return false

    const cell = payload.cell
    if (!cell) return false

    // must have children
    if (cell.hasChildrenFlag !== "true") return false

    // only marked-as-branch children can be opened
    return cell.isBranch
  }

  public override run = async (payload: CellPayload) => {
    // re-check
    if (this.state.isContextActive() || this.state.cancelled() || this.state.panning) {
      this.debug.log("BranchAction run suppressed (cancelled/panning/context)")
      return
    }

    const event = payload.event as any
    const pointerType = event?.pointerType || "mouse"

    // 🟢 IMPORTANT FIX:
    // Mouse should stop propagation because of hover menu collision.
    // Touch should NOT stop/NOT prevent default or navigation breaks.
    if (pointerType === "mouse") {
      event.stopPropagation?.()
      event.preventDefault?.()
    }

    this.debug.log("BranchAction run invoked")

    this.combstore.invalidate()
    this.stack.push(payload.cell!)

    // hide menu after navigation
    setTimeout(() => this.menu.hide(), 50)
  }
}
