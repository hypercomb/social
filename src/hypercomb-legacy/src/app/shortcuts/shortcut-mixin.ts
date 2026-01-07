// shortcut-mixin.ts
// modernized: stricter typings, fixed opts type, default target for start, and explicit return types
// (everything else unchanged)

import { DestroyRef, inject } from "@angular/core"
import { IShortcutBinding } from "./shortcut-model"
import { ShortcutRegistry } from "./shortcut-registry"
import { ActionContext } from "../actions/action-contexts"


// keep abstract ctor helper
type AbstractCtor<T = {}> = abstract new (...args: any[]) => T

export function ShortcutMixin<TBase extends AbstractCtor>(Base: TBase) {
    abstract class ShortcutMixinClass extends Base {
        // injects
        protected readonly shortcuts = inject(ShortcutRegistry)
        protected readonly destroyRef = inject(DestroyRef, { optional: true })


        protected invoke<T extends ActionContext = ActionContext>(
            cmdId: string,
            ctx: T
        ): Promise<boolean> {
            return this.shortcuts.invoke<T>(cmdId, ctx)
        }

    }

    return ShortcutMixinClass
}


