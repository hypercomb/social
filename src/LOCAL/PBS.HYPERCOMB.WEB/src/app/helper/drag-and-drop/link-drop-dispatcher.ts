import { Injectable } from '@angular/core'
import { HiveEvents } from 'src/app/unsorted/constants'
import { Hypercomb } from '../../core/mixins/abstraction/hypercomb.base'
import { IDropDispatcher } from './i-drop-dispatcher'
import { HexagonLinkDroppedEvent } from '../events/event-interfaces'

@Injectable({
    providedIn: 'root'
})
export class LinkDropDispatcher extends Hypercomb implements IDropDispatcher {
    canDispatch(event: DragEvent): boolean {
        const dataTransfer = event.dataTransfer!
        const url = <string>dataTransfer.getData('text/plain')

        // Check if the text is a URL (starting with "http" or "https")
        const valid = url.startsWith("http")
        this.debug.log('clipboard', `${LinkDropDispatcher.name} valid: ${valid}`)
        return valid
    }

    public dispatch = async (event: DragEvent): Promise<boolean> => {
        const dataTransfer = event.dataTransfer!
        const link = <string>dataTransfer.getData('text/plain')
        // Dispatch a custom event with the URL detail
        const dispatch = new CustomEvent<HexagonLinkDroppedEvent>(HiveEvents.HexagonLinkDropped, {
            detail: { event, link } // Assuming the event detail expects a property named 'url'
        })
        document.dispatchEvent(dispatch)
        return true
    }
}


