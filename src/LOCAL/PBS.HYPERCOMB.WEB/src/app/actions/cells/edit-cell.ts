// edit-tile.action.ts
import { Injectable, inject } from "@angular/core"
import { CellContext } from "../action-contexts"
import { ActionBase } from "../action.base"
import { CellEditor } from "src/app/unsorted/hexagons/cell-editor"


@Injectable({ providedIn: "root" })
export class EditTileAction extends ActionBase<CellContext> {

  public id = "layout.editTile"
  public override label = "Edit Tile"
  public override description = "Edit the active tile"
  public override category = "Editing"
  public override risk: "warning" = "warning"

  private readonly manager = inject(CellEditor)

  public override enabled = async (payload: CellContext): Promise<boolean> => {
    const up = <MouseEvent>payload.event
    return !!payload.cell && !this.state.isChoosingEditContext || (up.button === 2)
  }

  public run = async (payload: CellContext): Promise<void> => {
    const image = await this.images.getBaseImage(payload.cell)
    payload.cell.image = image
    this.manager.beginEditing(payload.cell)
  }
}
