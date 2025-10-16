import { Injectable, effect, inject } from "@angular/core"
import { Action } from "../action-models"
import { CellContext } from "../action-contexts"
import { CenterTileService } from "src/app/cells/behaviors/center-tile-service"
import { ActionBase } from "../action.base"

@Injectable({ providedIn: "root" })
export class CenterHiveAction extends ActionBase<CellContext> implements Action<CellContext> {
    public readonly center = inject(CenterTileService)


    public id = "layout.centerTile"
    public override label = "Center Tile"
    public override description = "Center the given tile on the screen"
    public override category = "Layout"
    public override risk: "none" = "none"

    public override enabled = async (_?: CellContext): Promise<boolean> => {
        return true
    }

    public run = async (payload: CellContext): Promise<void> => {

        const cell = payload.hovered!
        // safe due to enabled guard
        if (cell) {
            const tile = this.combstore.lookupTile(cell.cellId)
            if (!tile) return
            this.center.arrange(tile)
        }
        else {
            this.center.arrange() // center on comb
        }
    }
}
