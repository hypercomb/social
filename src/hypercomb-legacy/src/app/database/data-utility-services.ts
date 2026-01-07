import { Injectable } from '@angular/core'

@Injectable({
    providedIn: 'root'
})
export class DataUtilityService {

    public base64ToBlob = async (base64: string) => {
        try {
            const response = await fetch(base64)
            const blob = await response.blob()
            return blob
        }
        catch {
            return undefined
         }
    }

    public readFileAsArrayBuffer = async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = (event: any) => {
                resolve(event.target.result)
            }
            reader.onerror = (event: any) => {
                reject(event.target.error)
            }
            reader.readAsArrayBuffer(file)
        })
    }
}

