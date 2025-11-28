// src/app/actions/navigation/open-link.action.ts
import { Injectable, inject } from "@angular/core"
import { HypercombMode, POLICY } from "../../core/models/enumerations"
import { LinkNavigationService } from "../../navigation/link-navigation-service"
import { CellPayload } from "../action-contexts"
import { ActionBase } from "../action.base"
import { Cell } from "src/app/cells/cell"

@Injectable({ providedIn: "root" })
export class OpenLinkAction extends ActionBase<CellPayload> {
  public static ActionId = "cell.openLink"
  public id = OpenLinkAction.ActionId
  public override label = "Open Link"
  public override description = "Open the link associated with a cell"
  public override category = "Navigation"
  private readonly nav = inject(LinkNavigationService)

  // prevent accidental taps after a pan or drag
  public override enabled = async (payload: CellPayload): Promise<boolean> => {
    // block if the gesture was cancelled or a pan is active
    if (this.state.cancelled()) return false
    if (this.state.panning) return false

    const cell = payload.cell || payload.hovered
    let allowed = !!cell
    allowed &&= this.state.hasMode(HypercombMode.Normal)
    allowed &&= !cell?.isBranch
    allowed &&= !this.state.isViewingClipboard

    const policy = this.policy
    if (policy && policy.has && policy.has(POLICY.CommbandModeActive)) {
      return false
    }
    return allowed
  }

  public override run = async (payload: CellPayload): Promise<void> => {
    // double-check in case a pan started just before execution
    if (this.state.cancelled() || this.state.panning) {
      this.debug.log("OpenLinkAction run suppressed (cancelled/panning)")
      return
    }

    await this.nav.openLink((payload.cell || payload.hovered) as Cell)
  }
}
