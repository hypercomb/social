import { HttpClient } from '@angular/common/http'
import { inject, Injectable, Injector, Type } from '@angular/core'
import { DebugService } from 'src/app/core/diagnostics/debug-service'
import { EventDispatcher } from 'src/app/helper/events/event-dispatcher'
import { Events } from 'src/app/helper/events/events'
import { HypercombState } from 'src/app/state/core/hypercomb-state'

@Injectable({
    providedIn: 'root'
})
export abstract class FileDispatchBase {
    protected readonly http = inject(HttpClient)
    protected readonly debug = inject(DebugService)
    protected readonly files: string = 'Files'
    protected readonly plain: string = 'text/plain'
    protected readonly uriList: string = 'text/uri-list'
    protected readonly html: string = 'text/html'
    protected get isMac(): boolean { return /Mac|iMac|Macintosh/.test(navigator.userAgent) }

    protected get eventDispatcher(): EventDispatcher { return this.injector.get<EventDispatcher>(EventDispatcher as Type<EventDispatcher>) }
    protected get hives(): HypercombState { return this.injector.get<HypercombState>(HypercombState as Type<HypercombState>) }

    constructor(private injector: Injector) { }

    protected abstract canDispatch(dropEvent): Promise<boolean>
    protected abstract dispatching(dropEvent): Promise<boolean>

    public dispatch = async (dropEvent): Promise<boolean> => {
        const canDispatch = await this.canDispatch(dropEvent)
        if (!canDispatch) return false
        return await this.dispatching(dropEvent)
    }

    protected notifyImageDrop = async (blob: Blob) => {
        const directDropEvent = new CustomEvent<any>(Events.DirectImageDrop, { detail: { Blob: blob } })
        // Dispatch the event from the document object
        document.dispatchEvent(directDropEvent)
    }

}

