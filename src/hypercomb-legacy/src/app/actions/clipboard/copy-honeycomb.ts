import { inject, Injectable } from "@angular/core"
import { CopyPayload } from "../action-contexts"
import { ActionBase } from "../action.base"
import { CopyService } from "src/app/clipboard/copy-service"

@Injectable({ providedIn: "root" })
export class CopyAction extends ActionBase<CopyPayload> {
  private readonly copysvc = inject(CopyService)

  public static ActionId = "clipboard.copy"
  public id = CopyAction.ActionId
  public override label = "Copy to Clipboard"
  public override description = "Copy selected tiles and all their children to the clipboard hive"
  public override category = "Clipboard"
  public override risk: "none" = "none"

  public override enabled = async (payload: CopyPayload): Promise<boolean> => {
    return payload.cells.length > 0
  }

  public run = async (payload: CopyPayload): Promise<void> => {
    await this.copysvc.copy(payload.cells)
  }
}
