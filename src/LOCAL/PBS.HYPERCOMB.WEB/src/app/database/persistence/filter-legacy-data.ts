import { Injectable } from '@angular/core'
import { IZipData } from './i-persistence-interfaces'
import { IRestoreFilter } from './i-restore-filter'
import { Cell } from 'src/app/cells/cell'

@Injectable({
    providedIn: 'root'
})
export class LegacyRestoreFilter implements IRestoreFilter {

    constructor() { }

    public canFilter = async (zipData: IZipData): Promise<boolean> => {
        return !!zipData.pageKeys
    }

    public filter = async (zipData: IZipData): Promise<Cell[]> => {
        if (!zipData.pageKeys || !zipData.local) {
            return []
        }
        const hive = zipData.pageKeys[1].Key.split("-")[1]
        return zipData.local.filter(d => {
            const current: string = d?.Key || ''
            return current.includes(hive)
        }) as Cell[]
    }
}


