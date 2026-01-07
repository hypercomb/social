import { Injectable } from "@angular/core"
import JSZip from "jszip"
import download from 'downloadjs';

@Injectable({
  providedIn: 'root'
})
export class ImageDownloadService {

  constructor() { }

  async downloadImagesAsZip(images: { blob: Blob, fileName: string }[]) {
    const zip = new JSZip()

    for (const image of images) {
      const arrayBuffer = await this.blobToArrayBuffer(image.blob)
      zip.file(image.fileName, arrayBuffer)
    }

    zip.generateAsync({ type: 'blob' }).then((content) => {
      download(content, 'images.zip', 'application/zip')
    })
  }

  private blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = reject
      reader.readAsArrayBuffer(blob)
    })
  }
}


