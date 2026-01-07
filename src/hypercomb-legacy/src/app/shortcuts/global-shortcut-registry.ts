// ðŸ‘ˆ add this

import { Injectable } from "@angular/core"
import { ShortcutRegistry } from "./shortcut-registry"

@Injectable({ providedIn: 'root' })
export class GlobalShortcutRegistry extends ShortcutRegistry {
    constructor() {
        super()
        // // tell register what ctx type this handler receives
        // this.register<KeyboardEvent>('r:up', async (ev) => {
        //     ev.preventDefault()
        //     // emit a proper ActionContext (has the 'kind' tag)
        //     await this.invoke<ActionContext>('mode.toggleMove', fromKeyboard(ev))
        //     return true
        // })
    }
}


