import { Injectable, effect, untracked } from "@angular/core"
import { DataServiceBase } from "src/app/database/pixi-data-service-base"

@Injectable({ providedIn: 'root' })
export class KeyBindingService extends DataServiceBase {

    private readonly effect = effect(() => {

        const e = this.ks.keyUp()
        if (!e) return

        if (e.key.toLowerCase() === 'l') {
            untracked(() => {

                // this.commandBus.execute('tile.toggleLock')
            })
        }
    })
}



