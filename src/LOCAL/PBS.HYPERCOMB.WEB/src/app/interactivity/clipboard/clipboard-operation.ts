// clipboard-operation.ts
import { inject } from "@angular/core"
import { DataServiceBase } from "src/app/actions/service-base-classes"
import { Cell } from "src/app/cells/cell"
import { Constants } from "src/app/unsorted/constants"
import { HoneycombService } from "src/app/unsorted/utility/honeycomb-service"


export abstract class ClipboardOperation extends DataServiceBase {

    protected readonly clipboardState = inject(ClipboardState)
    protected readonly honeycomb = inject(HoneycombService)

    public setIndex = async (data: Cell) => {
        const list = await this.hierarchy_queries.fetchHierarchy(Constants.ClipboardHive, data.cellId!)
        const index = await this.honeycomb.findLowestIndex(list)
        data.index = index
    }

}


