import { Injectable } from "@angular/core"

@Injectable({ providedIn: 'root' })
export class SerializationService {

    public blobToBase64 = async (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
        })
    }

    public base64ToBlobWithoutHeader = async (base64: string, mimeType: string): Promise<Blob> => {
        try {
            // Sanitize Base64 string (remove whitespace and invalid characters)
            const sanitizedBase64 = base64.replace(/[^A-Za-z0-9+/=]/g, '')
    
            // Decode Base64
            const byteString = atob(sanitizedBase64)
    
            // Create ArrayBuffer and Uint8Array
            const ab = new ArrayBuffer(byteString.length)
            const ia = new Uint8Array(ab)
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i)
            }
    
            // Return Blob
            return new Blob([ab], { type: mimeType })
        } catch (error) {
            console.error('Error decoding Base64 string to Blob:', error)
            throw error // Rethrow for further handling
        }
    }
    
    public base64ToBlob = async (base64: string, mimeType: string) => {
        const byteString = atob(base64.split(',')[1])
        const ab = new ArrayBuffer(byteString.length)
        const ia = new Uint8Array(ab)
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i)
        }
        return new Blob([ab], { type: mimeType })
    }

    public getMimeTypeFromBase64(base64: string): string {
        const match = base64.match(/data:([^]+)/)
        if (match && match[1]) {
            return match[1]
        }
        throw new Error('Invalid Base64 string: MIME type not found.')
    }
}



