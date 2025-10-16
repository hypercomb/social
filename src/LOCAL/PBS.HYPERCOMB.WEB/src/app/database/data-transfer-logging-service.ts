import { Injectable } from '@angular/core'

@Injectable({
  providedIn: 'root'
})
export class DragDropLoggingService {

  constructor() { }

  logDataTransferObject(dataTransfer: DataTransfer) {
    if (!dataTransfer) {
this.debug.log('error', 'No data transfer object provided')
      return
    }

this.debug.log('db', 'Data Transfer Object Details:')

    // Log the types
this.debug.log('db', 'Types:', dataTransfer.types)

    // Iterate over each type and log its content using getData
    dataTransfer.types.forEach(type => {
      const data = dataTransfer.getData(type)
this.debug.log('db', `Type: ${type}, Data: ${data}`)
    })

    // Log details about items if they are available
    if (dataTransfer.items && dataTransfer.items.length > 0) {
this.debug.log('db', `Number of items: ${dataTransfer.items.length}`)
      Array.from(dataTransfer.items).forEach((item, index) => {
this.debug.log('db', `Item ${index + 1}: Kind - ${item.kind}, Type - ${item.type}`)

        if (item.kind === 'string') {
          item.getAsString(data => {
this.debug.log('db', `Item ${index + 1} Data: ${data}`)
          })
        } else if (item.kind === 'file') {
          const file = item.getAsFile()
this.debug.log('db', `Item ${index + 1} File:`, file)
        }
      })
    }
  }
}


