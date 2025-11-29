import { Injectable } from "@angular/core"
import { ActionBase } from "../action.base"
import { HypercombMode } from "src/app/core/models/enumerations"

@Injectable({ providedIn: "root" })
export class CloseExternalAction extends ActionBase<void> {
  public static ActionId = 'close.external'
  public id = CloseExternalAction.ActionId
  public override label = 'Close External Media'
  public override description = 'Close YouTube, modals, overlays, etc.'
  
  public override enabled = async () => true
  public override run = async () => {
    this.menu.hide()
    this.state.removeMode(HypercombMode.YoutubeViewer)
    this.state.setHoneycombStatus(false)
  }
}
