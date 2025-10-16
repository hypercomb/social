import { Injectable } from '@angular/core'
import JSZip from 'jszip'
import { DataUtilityService } from '../data-utility-services'
import { IZipData } from '../persistence/i-persistence-interfaces'


@Injectable({
    providedIn: 'root'
})
export class ZipService {
    constructor(private dataUtilityService: DataUtilityService) { }

    // UtilityService
    public getBackupData = async (file: File): Promise<IZipData> => {

        const { local, pageKeys } = await this.getExportData(file)
        const localData = JSON.parse(local)
        // const largeData = JSON.parse(large) ``
        const pageKeyData = pageKeys ? JSON.parse(pageKeys) : []

        console.warn("The hive needs to be set for the backup/restore to work properly")
        return { local: localData, pageKeys: pageKeyData, Hive: '' }
    }

    public getExportData = async (file: File): Promise<{ local, pageKeys }> => {
        const data = <any>(await this.dataUtilityService.readFileAsArrayBuffer(file))
        const zip = new JSZip()
        const decompressed = await zip.loadAsync(data)
        const jsonFile = await decompressed.file('database-backup.json')
        const jsonString = await jsonFile!.async('string')
        return JSON.parse(jsonString)
    }
}

