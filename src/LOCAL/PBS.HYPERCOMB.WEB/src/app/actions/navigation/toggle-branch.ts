// actions/toggle-branch.command.ts
import { Injectable } from "@angular/core"
import { CellOptions, POLICY } from "../../core/models/enumerations"
import { CellPayload } from "../action-contexts"
import { ActionBase } from "../action.base"
import { Cell } from "src/app/models/cell"

@Injectable({ providedIn: "root" })
export class ToggleBranchAction extends ActionBase<CellPayload> {
  public id = "layout.toggleBranch"
  public override label = "Toggle Branch"
  public override description = "Flip the branch flag on the focused cell"

  public override enabled = async (payload: CellPayload): Promise<boolean> => {
    return !!payload.cell
  }

  public run = async (payload: CellPayload) => {
    const cell: Cell | undefined = payload.cell
    if (!cell) return

    try {
      cell.options.update((options) => options ^ CellOptions.Branch)   // flip the bit
      await this.modify.updateCell(cell)
    } catch (err) {
      console.error("failed to toggle branch flag:", err)
    }
  }
}
