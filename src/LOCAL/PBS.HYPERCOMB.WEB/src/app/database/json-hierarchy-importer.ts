import { Injectable, inject } from "@angular/core"
import { HierarchyRestorationService } from './hierarchy/data-hierarchy-organizer'
import { Cell } from "../cells/cell"
import { NewTileService } from "../cells/creation/new-tile-service"
import { CellFactory } from "../inversion-of-control/factory/cell-factory"
import { AxialService } from "../unsorted/utility/axial-service"
import { DataServiceBase } from "../actions/service-base-classes"
import { HoneycombService } from "../hive/honeycomb-service"

@Injectable({
    providedIn: 'root'
})
export class JsonHierarchyImporter extends DataServiceBase {

    private readonly axial = inject(AxialService)
    private readonly restoration = inject(HierarchyRestorationService)
    private readonly honeycomb = inject(HoneycombService)
    private readonly new_tiles = inject(NewTileService)
    private readonly td_factor = inject(CellFactory)

    public clearTempIdentifiers = async (cell: Cell[]) => {
        for (const data of cell) {
            delete (<any>data).TempId
            delete (<any>data).TempSourceId
        }
    }

    public createTiles = async (inputData: any[]) => {

        const data = this.stack.top()!
        const sourceId = data.cellId
        const hive = data?.hive
        await this.restoration.restore(hive, inputData)

        // const indexes = this.layout.indexes
        // const updates: Cell[] = []

        // inputData = inputData.filter(d => d.sourceId && d.sourceId != 998) // 998 is the import root.

        // this.setTempIdentifiers(inputData)

        // for (const item of inputData) {

        //     const name = item?.name || item.name
        //     const link = item?.link || item.link
        //     const index = item.index || await this.honeycombService.findLowestNextIndex(indexes)
        //     const axial = this.axialService.Axials.get(index)!
        //     const location = new Point(axial.Location?.x, axial.Location?.y)
        //     const options = <ITileDataOptions>{ index, location }
        //     const cell = await this.tileDataFactory.createWithOptions(options)

        //     // set properties 
        //     cell.name = name
        //     cell.link = link


        //     // 
        //     const stub = <Cell>await this.tileDataFactory.createNew(<any>{})
        //     //  sourceId!, location, hive

        //     const dataUpdates = <any>{
        //         // ...result.data,
        //         Name: name,
        //         Link: link,
        //         SourceId: sourceId,
        //         // SourcePath: tilesourcePath,
        //         // Blob: tile.blob,
        //         IsBranch: item.isBranch,
        //         TempId: item.cellId,
        //         TempSourceId: item.sourceId
        //     }

        //     // Ensure all required properties are merged into result.data
        //     const data = <any>{ ...stub, ...dataUpdates }
        //      updates.push(data)
        // }

        // await this.setIdentifierHierarchy(updates)

        // await this.clearTempIdentifiers(updates)

        // await this.tile_actions.bulkPut(updates).then(d => {
        //     console.log('completed')
        //     // debugger
        // }).catch(err => {
        //     //  debugger
        // })
    }

    private setIdentifierHierarchy = async (cell: any[]) => {
        // // Create a map to look up tiles by their TempId
        // const tempIdMap = new Map<string, any>()
        // for (const cell of cell) {
        //     tempIdMap.set(cell.TempId, cell)
        // }

        // for (const cell of cell) {
        //     if (cell.TempSourceId) {
        //         // Look up the parent tile using TempSourceId
        //         const parentTile = tempIdMap.get(cell.TempSourceId)
        //         if (parentTile) {
        //             // Set the correct Id and SourceId
        //             cell.sourceId = parentTile.cellId
        //         }
        //     }
        // }
        throw new Error('Method not implemented.')
    }

    private setTempIdentifiers = async (cell: any) => {
        for (let tile of cell) {
            tile.TempId = tile.cellId || tile.Id
            tile.TempSourceId = tile.sourceId
        }
    }
}


