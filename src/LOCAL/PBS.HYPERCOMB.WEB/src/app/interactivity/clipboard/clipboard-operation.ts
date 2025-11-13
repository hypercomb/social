// clipboard-operation.ts
import { inject } from "@angular/core"
import { HypercombData } from "src/app/actions/hypercomb-data"
import { Cell } from "src/app/cells/cell"
import { Constants } from "src/app/unsorted/constants"



export abstract class ClipboardOperation extends HypercombData {

    public setIndex = async (data: Cell) => {
        // const list = await this.hierarchy_queries.fetchHierarchy(Constants.ClipboardHive, data.cellId!)
        // const index = await this.honeycomb.findLowestIndex(list)
        // data.index = index
    }

}


