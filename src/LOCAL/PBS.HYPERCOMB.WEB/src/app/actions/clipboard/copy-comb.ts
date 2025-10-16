// actions/toggle-copy-mode.action.ts
import { inject, Injectable } from "@angular/core"
import { CellListContext } from "../action-contexts"
import { ActionBase } from "../action.base"
import { CopyService } from "src/app/clipboard/copy-service"

@Injectable({ providedIn: "root" })
export class ClipboardCopyAction extends ActionBase<CellListContext> {
  private readonly copyservice = inject(CopyService)

  public id = "clipboard.copy"
  public override label = "Copy cell items to the clipboard"
  public override description = "Copy cell items to the clipboard"
  public override category = "Mode"
  public override risk: "none" = "none"

  public override enabled = async (): Promise<boolean> => true

  public run = async (payload: CellListContext): Promise<void> => {
   this.copyservice.copy(payload.cells)
  }
}
