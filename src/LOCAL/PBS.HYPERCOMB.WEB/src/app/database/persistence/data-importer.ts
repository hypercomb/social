import { Injectable } from '@angular/core'
import { DataUtilityService } from '../data-utility-services'
import { DataServiceBase } from 'src/app/actions/service-base-classes'
import { Cell } from 'src/app/cells/cell'

@Injectable({
  providedIn: 'root'
})
export class DataImporter extends DataServiceBase {
  constructor(private dataUtilityService: DataUtilityService) {
    super()
  }

  public import = async (localData: Cell[]) => {

    const newData: Cell[] = []

    // process adding new copies of the dat to the database
    for (const record of localData) {
      try {
        delete (<any>record).cellId
        record.isActive = true

        // switch from Key to Hive
        if (!record.hive) {
          delete (<any>record).Key
        }

        if (record.blob && !(record.blob instanceof Blob)) {
          record.blob = await this.dataUtilityService.base64ToBlob(record.blob)
        }

        newData.push(record)
      } catch (error) {
        this.debug.log('error', error)
      }
    }
    try {
      // persist data.
      await this.tile_actions.bulkAdd(newData)
    }
    catch (error) {
      //  debugger
    }

  }
}


