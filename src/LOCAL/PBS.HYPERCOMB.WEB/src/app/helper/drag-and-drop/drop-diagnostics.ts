import { Injectable } from '@angular/core'
import { Hypercomb } from '../../core/mixins/abstraction/hypercomb.base'

@Injectable({
  providedIn: 'root'
})
export class DropDiagnosticsService extends Hypercomb {

  public show = (event: DragEvent) => {
    const items = Array.from(event.dataTransfer?.items || []).map((item) => ({
      kind: item.kind,
      type: item.type,
    }))

    const dataFormats: Record<string, string> = {}
    if (event.dataTransfer) {
      for (const format of event.dataTransfer.types) {
        try {
          const data = event.dataTransfer.getData(format)
          if (data) {
            dataFormats[format] = data
          }
        } catch {
          // Ignore inaccessible data formats
        }
      }
    }

    this.debug.log('clipboard', `Dragged Data:\n\nItems: ${JSON.stringify(items, null, 2)}\n\nData Formats: ${JSON.stringify(dataFormats, null, 2)}`)
    this.debug.log('clipboard', event.dataTransfer?.items["text/html"])
  }

}


