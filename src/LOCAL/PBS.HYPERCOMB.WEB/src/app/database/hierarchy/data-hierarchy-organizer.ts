import { Injectable, inject } from "@angular/core"
import { BlobService } from "../../hive/rendering/blob-service"
import { HypercombData } from "src/app/actions/hypercomb-data"
import { Cell } from "src/app/cells/cell"
import { RestorableTileData } from "src/app/cells/flow/restorable-tile"
import DBTables from "src/app/core/constants/db-tables"
import { isHive } from "src/app/cells/models/cell-filters"
import { MODIFY_COMB_SVC } from "src/app/shared/tokens/i-comb-service.token"

@Injectable({
    providedIn: 'root'
})
export class HierarchyRestorationService extends HypercombData {
    private readonly modify = inject(MODIFY_COMB_SVC)
    private readonly blobService = inject(BlobService)

    public restore = async (hiveName: string, hiveData: Cell[]) => {
        if (!hiveData.length) return
        let restorableList: RestorableTileData[] = []

        // start transaction on necessary tables (adjust db.tables as needed)
        const db = this.ds.db()!
        await db.transaction('rw', db.table(DBTables.Cells), async () => {

            // // set the identifier fields from the old item
            // await Promise.all(hiveData.map(async item => {

            //     const restorable = new RestorableTileData(item)

            //     // create tiles
            //     const cell = new Cell(item)
            //     cell.hive = hiveName

            //     const { id,cellId, ...dataWithoutIds } = <any>cell
            //     const newCell = await this.modify.addCell(dataWithoutIds)

            //     restorable.newItem = newCell
            //     restorableList.push(restorable)
            // }))
            throw new Error("Not implemented")

            await this.restoreSourceIdentifiers(restorableList)

        })

        // perform additional blob restoration or other updates
        await this.restoreBlobs(restorableList)
        this.debug.log('db', `done restoring hive:${hiveName}`)
    }


    private restoreSourceIdentifiers(restorableList: RestorableTileData[]) {
        for (const restorable of restorableList) {
            const current = restorable.newItem!

            // Find the source item using SourceId
            const source = restorableList.find(x => restorable.sourceId === x.Id || restorable.sourceId === x.cellId)

            // Set SourceId for the current item's newItem
            current.sourceId = isHive(current) ? -1 : source?.newItem!.cellId
        }
    }


    public restoreBlobs = async (restorableList: RestorableTileData[]) => {

        try {
            const blobs = await Promise.all(restorableList.map(r => this.blobService.fetchImageAsBlob(r.sourcePath!)))

            // blobs.forEach((blob, index) => {
            //     restorableList[index].newItem!.blob = blob
            // })
            throw new Error("Not implemented")
            const dataArray = <Cell[]>restorableList.map(r => r.newItem)
            await this.modify.bulkPut(dataArray)

            this.debug.log('db', 'Blobs and base64 data restored successfully.')
        } catch (error) {
            console.error('Error in restoreBlobs:', error)
            throw error
        }
    }

}


