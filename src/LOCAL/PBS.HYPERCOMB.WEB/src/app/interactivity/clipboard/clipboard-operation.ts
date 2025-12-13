// clipboard-operation.ts
import { inject } from "@angular/core"
import { Hypercomb } from "src/app/actions/hypercomb-data"
import { Cell } from "src/app/models/cell-kind"
import { Constants } from "src/app/helper/constants"



export abstract class ClipboardOperation extends Hypercomb {

    public setIndex = async (data: Cell) => {
        // const list = await this.hierarchy_queries.fetchHierarchy(Constants.ClipboardHive, data.cellId!)
        // const index = await this.honeycomb.findLowestIndex(list)
        // data.index = index
    }

}


