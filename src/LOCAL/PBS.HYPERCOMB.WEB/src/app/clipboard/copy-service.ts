import { Injectable } from "@angular/core"
import { Cell } from "../cells/cell"

@Injectable({ providedIn: "root" })
export class CopyService {

    /**
     * Copy one or more cells and all their children into the Clipboard hive.
     */
    public async copy(cells: Cell[]): Promise<Cell[]> {
        // const results: Cell[] = []
        // this.query.fetchBySourceId
        // for (const cell of cells) {
        //     // 1. create a new clipboard root
        //     const { cellId, ...rest } = cell
        //     const root = await this.factory.create({
        //         ...rest,
        //         kind: "Clipboard",
        //         sourceId: undefined,
        //     })

        //     // 2. walk children recursively
        //     await this.copyChildren(cell.cellId!, root.cellId!)

        //     results.push(root)
        // }

        // return results
        throw new Error("Not implemented yet")
    }

    /**
     * Recursively copy children of a given source cell, attaching them to the new parent.
     */
    private async copyChildren(sourceCellId: number, targetCellId: number): Promise<void> {
        // const children = await this.query.fetchBySourceId(sourceCellId) || []

        // for (const child of children) {
        //     const { cellId, ...rest } = child
        //     const copy = await this.factory.create({
        //         ...rest,
        //         sourceId: targetCellId,
        //     })

        //     // recurse into this child’s children
        //     await this.copyChildren(child.cellId!, copy.cellId!)
        // }
    }
}

