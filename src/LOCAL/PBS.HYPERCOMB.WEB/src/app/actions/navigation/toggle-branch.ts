// actions/toggle-branch.command.ts
import { Injectable } from "@angular/core"
import { CellOptions, POLICY } from "../../core/models/enumerations"
import { Cell } from "../../cells/cell"
import { CellContext } from "../action-contexts"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class ToggleBranchAction extends ActionBase<CellContext> {
  public id = "layout.toggleBranch"
  public override label = "Toggle Branch"
  public override description = "Flip the branch flag on the focused cell"

  public override enabled = async (payload: CellContext): Promise<boolean> => {
    if (this.policy.any(POLICY.NoActiveTile)) return false
    return !!payload.cell
  }

  public run = async (payload: CellContext) => {
    if (this.policy.any(POLICY.NoActiveTile)) return

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
