// actions/delete-pathway.action.ts
import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "src/app/core/models/enumerations"
import { Cell } from "src/app/cells/cell"
import { COMB_SERVICE } from "src/app/shared/tokens/i-comb-store.token"
import { CellContext } from "src/app/actions/action-contexts"
import { ActionBase } from "src/app/actions/action.base"

@Injectable({ providedIn: "root" })
export class DeletePathwayAction extends ActionBase<CellContext> {
    private readonly tiles = inject(COMB_SERVICE)

    public override id = "layout.deletePathway"
    public override label = "Delete Pathway"
    public override description = "Delete a hypercell tile (linked to hypercomb.io or localhost)"
    public override category = "Editing"
    public override risk: "danger" = "danger"
    private readonly urls = ["hypercomb.io", "localhost:4200"]

    public override enabled = async (payload: CellContext): Promise<boolean> => {
        const cell: Cell | undefined = payload.cell
        if (!cell) return false

        const linkBlocked = this.urls.some(url => cell.link?.includes(url))
        const inNormalMode = this.state.hasMode(HypercombMode.Normal)

        return linkBlocked && inNormalMode
    }

    public override run = async (payload: CellContext): Promise<void> => {
        const active = payload.cell
        if (!active) return

        await this.tiles.(active)
    }
}
