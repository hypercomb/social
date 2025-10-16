import { Injectable } from '@angular/core'
import { IZipData } from './i-persistence-interfaces'
import { IRestoreFilter } from './i-restore-filter'
import { Cell } from 'src/app/cells/cell'

@Injectable({
    providedIn: 'root'
})
export class HiveRestoreFilter implements IRestoreFilter {

    constructor() { }

    public canFilter = async (zipData: IZipData): Promise<boolean> => {
        return !zipData.pageKeys
    }

    public filter = async (zipData: IZipData): Promise<Cell[]> => {
        if (!zipData.local) {
            return []
        }
        return zipData.local.filter(d => d.hive == zipData.hive) as Cell[]
    }
}


