// actions/open-link.action.ts
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

  public override enabled = async (payload: CellPayload): Promise<boolean> => {
    const cell =   payload.cell || payload.hovered
    let allowed = !!cell
    allowed &&= this.state.hasMode(HypercombMode.Normal)
    allowed &&= !cell?.isBranch
    allowed &&= !this.state.isViewingClipboard
    // Block openLink if any command mode is active (policy)
    const policy = this.policy;
    if (policy && policy.has && policy.has(POLICY.CommbandModeActive)) {
      return false;
    }
    return allowed
  }

  public override  run = async (payload: CellPayload) => {
    await this.nav.openLink(payload.cell || payload.hovered as Cell)
  }
}
