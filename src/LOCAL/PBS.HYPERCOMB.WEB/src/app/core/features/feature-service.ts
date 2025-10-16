import { DestroyRef, inject, Injectable } from '@angular/core'
import { ShortcutRegistry } from 'src/app/shortcuts/shortcut-registry'

@Injectable()
export class MyFeatureService extends DebugMixin {
    private readonly shortcuts = inject(ShortcutRegistry)
    private readonly destroyRef = inject(DestroyRef)

    constructor() {
        // register shortcut just for this feature
        const off = this.shortcuts.register('r:up', ev => {
            this.debug.log('shortcuts', 'Feature-local handler!')
            return true
        })

        // auto unregister when service/component destroyed
        this.destroyRef.onDestroy(() => off())
    }
}


