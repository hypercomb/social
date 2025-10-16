import { Injectable } from '@angular/core'
import { Constants, HiveEvents } from 'src/app/unsorted/constants'
import { FileDispatchBase } from 'src/app/unsorted/external/file-drop-base'
import { IDropDispatcher } from './i-drop-dispatcher'
import { HexagonDropEvent } from '../events/event-interfaces'

@Injectable({
    providedIn: 'root'
})
export class HexagonDropDispatcher extends FileDispatchBase implements IDropDispatcher {
    public canDispatch = async (event: DragEvent): Promise<boolean> => {
        const dataTransfer = event.dataTransfer!
        const json = <string>dataTransfer.getData('text/plain')
        if (!json || json.startsWith("http")) {
            return false
        }
        try {
            const parsedData = JSON.parse(json)
            if (parsedData.type !== Constants.HypercombDataType) return false
            return true
        } catch (err) {
            console.error('Error parsing JSON:', err)
            return false
        }
    }

    public override dispatching = async (event: DragEvent): Promise<boolean> => {
        const dataTransfer = event.dataTransfer!
        const json = <string>dataTransfer.getData('text/plain')
        const dispatch = new CustomEvent<HexagonDropEvent>(HiveEvents.HexagonDropped, {
            detail: { event, json }
        })
        document.dispatchEvent(dispatch)

        return true
    }

}

