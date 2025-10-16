import { HypercombState } from "src/app/state/core/hypercomb-state"
import { ActionBase } from "../action.base"
import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "src/app/core/models/enumerations"


@Injectable({ providedIn: "root" })
export class ExploreStorageAction extends ActionBase {
    private readonly hivestate = inject(HypercombState)

    public static ActionId = "storage.explore"
    public id = ExploreStorageAction.ActionId
    public override label = "Explore Storage"
    public override description = "Open the storage explorer to view and manage files in OPFS"
    public override category = "Navigation"


    public override  run = async () => {
        this.menu.hide()
        this.hivestate.toggleToolMode(HypercombMode.OpfsFileExplorer)
    }
}
