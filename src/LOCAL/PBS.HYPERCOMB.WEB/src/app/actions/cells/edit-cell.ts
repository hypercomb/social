// edit-tile.action.ts
import { Injectable, inject } from "@angular/core"
import { CellPayload } from "../action-contexts"
import { ActionBase } from "../action.base"
import { CellEditor } from "src/app/unsorted/hexagons/cell-editor"
import { CellEditContext } from "src/app/state/interactivity/cell-edit-context"


@Injectable({ providedIn: "root" })
export class EditTileAction extends ActionBase<CellPayload> {

  public id = "layout.editTile"
  public override label = "Edit Tile"
  public override description = "Edit the active tile"
  public override category = "Editing"
  public override risk: "warning" = "warning"

  private readonly manager = inject(CellEditor)

  public override enabled = async (payload: CellPayload): Promise<boolean> => {
    const up = <MouseEvent>payload.event
    return !!payload.cell && !this.state.isChoosingEditContext || (up.button === 2)
  }

  public run = async (payload: CellPayload): Promise<void> => {
    const context = new CellEditContext(payload.cell)
    context.originalSmall = await this.images.getBaseImage(payload.cell)
    this.manager.beginEditing(context)
  }
}
