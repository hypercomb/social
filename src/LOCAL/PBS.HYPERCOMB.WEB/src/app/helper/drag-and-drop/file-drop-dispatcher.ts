
import { Injectable, Injector, signal } from "@angular/core"

import { CoordinateDetector } from "../detection/coordinate-detector"
import { IDropDispatcher } from "./i-drop-dispatcher"
import { FileDispatchBase } from "src/app/unsorted/external/file-drop-base"

@Injectable({ providedIn: 'root' })
export class FileDropDispatcher extends FileDispatchBase implements IDropDispatcher {
    private readonly _dropped = signal<File[] | null>(null)
    public readonly dropped = this._dropped.asReadonly()

    constructor(
        injector: Injector,
        public tileDetector: CoordinateDetector) {
        super(injector)
    }

    protected canDispatch = async (dragEvent: DragEvent): Promise<boolean> => {

        const { dataTransfer } = dragEvent
        const file = dataTransfer?.files[0]

        // minimum needs a file and a type 
        // menu mode is not allowed
        if (file && dataTransfer?.files[0]?.type) {
            return true
        }
        return false
    }

    public async dispatching(event: DragEvent): Promise<boolean> {
        const files = Array.from(event.dataTransfer!.files)
        this._dropped.set(files)
        this.notifyImageDrop(files[0])
        return true
    }

}

