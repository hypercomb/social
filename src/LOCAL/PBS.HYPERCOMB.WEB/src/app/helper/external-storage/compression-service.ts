import { Injectable } from "@angular/core"
import JSZip from "jszip"

@Injectable({
  providedIn: 'root'
})
export class CompressionService {

  async compressAndEncode(data: any): Promise<string> {
    const zip = new JSZip()
    const jsonString = JSON.stringify(data)
    zip.file('data.json', jsonString)

    const compressedData = await zip.generateAsync({ type: 'uint8array' })
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(compressedData)))

    return base64Data
  }

  async decodeAndDecompress(base64Data: string): Promise<any> {
    const binaryString = atob(base64Data)
    const binaryData = new Uint8Array(binaryString.split('').map(char => char.charCodeAt(0)))

    const zip = await JSZip.loadAsync(binaryData)
    const file = zip.file('data.json')

    if (file) {
      const decompressedData = await file.async('string')
      return JSON.parse(decompressedData)
    }

    throw new Error('Failed to decompress data')
  }
}


