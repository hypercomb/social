import { HttpClient, HttpHeaders } from "@angular/common/http"
import { Injectable, inject } from "@angular/core"
import { firstValueFrom } from "rxjs"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { Constants } from "src/app/helper/constants"
import { ImageDownloadService } from "./temp-downloader"

@Injectable({
  providedIn: "root"
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
  }

  public send = async (item: string): Promise<string> => {
    try {
      const { blobUrl } = (await firstValueFrom(this.uploadImage(item))) as any
      this.debug.log("http", "Image uploaded successfully", blobUrl)
      return blobUrl
    } catch (error) {
      console.error("Error uploading image", error)
      throw error
    }
  }

  private uploadImage(imageBase64: string) {
    const apiUrl = `${Constants.apiEndpoint}/StoreTileImage`
    const payload = { imageBase64 }
    const headers = new HttpHeaders({ "Content-Type": "application/json" })

    return this.http.post(apiUrl, payload, { headers })
  }
}
