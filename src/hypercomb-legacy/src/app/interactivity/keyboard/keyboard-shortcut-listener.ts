import { Injectable, inject, effect } from "@angular/core"
import { ShortcutRegistry } from "src/app/shortcuts/shortcut-registry"
import { KeyboardState } from "./keyboard-state"

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutListener {
    private ks = inject(KeyboardState)
    private shortcuts = inject(ShortcutRegistry)

    constructor() {

        effect(() => {
            const ev = this.ks.keyUp()
            if (!ev) return

            // const combo = this.describe(ev)
            // const cmd = SHORTCUTS[combo]
            // if (cmd) {
            //     this.shortcuts.invoke(cmd, fromKeyboard(ev))
            // }
        })
    }

    private describe(ev: KeyboardEvent): string {
        const parts: string[] = []
        if (ev.ctrlKey) parts.push('ctrl')
        if (ev.metaKey) parts.push('meta')
        if (ev.shiftKey) parts.push('shift')
        if (ev.altKey) parts.push('alt')
        parts.push(ev.key.toLowerCase())
        return parts.join('+')
    }
}


