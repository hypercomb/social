import { HttpHeaders } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { firstValueFrom } from 'rxjs'

import { SerializationService } from 'src/app/database/persistence/serialization-service'
import { Constants } from 'src/app/helper/constants'
import { IDropDispatcher } from './i-drop-dispatcher'
import { ImageSourceParser } from './image-element-source-parser'
import { FileDispatchBase } from 'src/app/helper/file-drop-base'

@Injectable({ providedIn: 'root' })
export class ImageSrcDropDispatcher extends FileDispatchBase implements IDropDispatcher {

    private readonly parser = inject(ImageSourceParser)
    private readonly serialization = inject(SerializationService)

    protected override canDispatch = async (event: DragEvent): Promise<boolean> =>
        !!event.dataTransfer?.types.includes('text/html')

    protected override dispatching = async (event: DragEvent): Promise<boolean> => {
        event.preventDefault()
        event.stopPropagation()

        const html = event.dataTransfer?.getData('text/html') ?? ''
        const [source] = this.parser.parse(html)

        if (!source || (!source.startsWith('https:') && !source.startsWith('data:image'))) {
            return false
        }

        try {
            const blob = source.startsWith('https:')
                ? await this.fetchProxiedImage(source)
                : await this.decodeBase64Image(source)

            await this.notifyImageDrop(blob)
            return true
        } catch (error) {
            this.debug.log('drop', 'error handling image source', error)
            return false
        }
    }

    private async fetchProxiedImage(source: string): Promise<Blob> {
        const url = `${Constants.apiEndpoint}/GetProxiedImage?link=${encodeURIComponent(source)}`
        const headers = new HttpHeaders({ 'Content-Type': 'application/json' })
        const response = await firstValueFrom(this.http.get<{ image: string }>(url, { headers }))
        return this.serialization.base64ToBlobWithoutHeader(response.image, 'image/webp')
    }

    private async decodeBase64Image(source: string): Promise<Blob> {
        const mimeType = await this.serialization.getMimeTypeFromBase64(source)
        return this.serialization.base64ToBlob(source, mimeType)
    }
}


