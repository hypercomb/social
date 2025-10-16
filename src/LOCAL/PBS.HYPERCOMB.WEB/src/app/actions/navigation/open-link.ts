// actions/open-link.action.ts
import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "../../core/models/enumerations"
import { LinkNavigationService } from "../../navigation/link-navigation-service"
import { CellContext } from "../action-contexts"
import { ActionBase } from "../action.base"
import { Cell } from "src/app/cells/cell"

@Injectable({ providedIn: "root" })
export class OpenLinkAction extends ActionBase<CellContext> {
  public static ActionId = "cell.openLink"
  public id = OpenLinkAction.ActionId
  public override label = "Open Link"
  public override description = "Open the link associated with a cell"
  public override category = "Navigation"
  private readonly nav = inject(LinkNavigationService)

  public override enabled = async (payload: CellContext): Promise<boolean> => {
    const cell =   payload.cell || payload.hovered
    let allowed = !!cell
    allowed &&= this.state.hasMode(HypercombMode.Normal)
    allowed &&= !cell?.isBranch
    allowed &&= !this.state.isViewingClipboard
    return allowed
  }

  public override  run = async (payload: CellContext) => {
    await this.nav.openLink(payload.cell || payload.hovered as Cell)
  }
}
