import { HttpClient, HttpHeaders } from "@angular/common/http"
import { Injectable, inject } from "@angular/core"
import { firstValueFrom } from "rxjs"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { Constants } from "src/app/unsorted/constants"
import { ImageDownloadService } from "./temp-downloader"

@Injectable({
  providedIn: 'root'
})
export class ThumbnailExporter extends Hypercomb {
  public readonly download = inject(ImageDownloadService)
  public readonly http = inject(HttpClient)

  public downloadImages = async (images: any[]) => {
    const formattedData = images.map(item => ({
      blob: item.blob,
      fileName: `image${item.cellId}.webp`
    }))

    await this.download.downloadImagesAsZip(formattedData)
    this.download.downloadImagesAsZip(images)
  }

  public send = async (item: string): Promise<string> => {
    try {
      const { blobUrl } = <any>(await firstValueFrom(this.uploadImage(item)))

      this.debug.log('http', 'Image uploaded successfully', blobUrl)

      return blobUrl  // Changed from '' to return the actual response 
    } catch (error) {
      console.error('Error uploading image', error)
      throw error  // Propagate the error to the caller
    }
  }

  private uploadImage(imageBase64: string) {
    const apiUrl = `${Constants.apiEndpoint}/StoreTileImage` // Replace with your function endpoint
    const payload = { imageBase64 }
    const headers = new HttpHeaders({ 'Content-Type': 'application/json' })

    return this.http.post(apiUrl, payload, { headers })
  }
}


