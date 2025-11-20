import { Injectable } from '@angular/core'
import { Cell } from 'src/app/cells/cell'
import { SerializationService } from 'src/app/database/persistence/serialization-service'

@Injectable({ providedIn: 'root' })
export class HoneycombSerializer {
    constructor(private serializationService: SerializationService) { }

    public async serializeHoneycombData(honeycombDataArray: Cell[]): Promise<{ json: string, blob64?: string[] }> {
        const serializedArray = await Promise.all(honeycombDataArray.map(async (honeycombData) => {
            const dataCopy = { ...honeycombData }
            let blob64Data: string | undefined = undefined

            if (dataCopy.blob instanceof Blob) {
                blob64Data = await this.serializationService.blobToBase64(dataCopy.blob)
                delete dataCopy.blob // Remove Blob after conversion to base64
            }
            return { data: dataCopy, blob64: blob64Data }
        }))

        const jsonData = JSON.stringify(serializedArray.map(item => item.data))
        const blob64Array = serializedArray.map(item => item.blob64).filter(blob => blob !== undefined) as string[]

        return { json: jsonData, blob64: blob64Array }
    }

    public async deserializeHoneycombData(serializedData: { json: string, blob64?: string[] }): Promise<Cell[]> {
        const dataArray = JSON.parse(serializedData.json) as any[]
        return await Promise.all(dataArray.map(async (dataObject, index) => {
            if (serializedData.blob64 && serializedData.blob64[index]) {
                const mimeType = this.serializationService.getMimeTypeFromBase64(serializedData.blob64[index])
                dataObject.blob = await this.serializationService.base64ToBlob(serializedData.blob64[index], mimeType)
            }
            return new Cell(dataObject)
        }))
    }
}


