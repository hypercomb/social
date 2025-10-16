// command-mixin.ts

import { inject, DestroyRef, Signal } from "@angular/core"
import { ActionContext } from "src/app/actions/action-contexts"
import { ActionRegistry } from "src/app/actions/action-registry"
import { AbstractCtor } from "src/app/core/mixins/mixin-helpers"

export function CommandMixin<TBase extends AbstractCtor>(Base: TBase) {
    abstract class CommandMixinClass extends Base {
        public abstract id: string
        public description?: string
        public category?: string
        public risk: 'warning' | 'danger' = 'warning'
        public label: string | undefined
        public enabled = (() => true) as Signal<boolean>

        private readonly commands = inject(ACTION_REGISTRY)
        private readonly destroyRef = inject(DestroyRef, { optional: true })
        constructor(...args: any[]) {
            super(...args)

            queueMicrotask(() => {
                if ((this as any)._registered) return
                const id = (this as any).id || (this.constructor as any).ID || (this.constructor as any).commandId
                if (!id) {
                    console.warn(`${this.constructor.name}: missing command id`)
                    return
                }

                this.commands.register(this as any)
                    ; (this as any)._registered = true
                this.destroyRef?.onDestroy(() => { (this as any)._registered = false })
            })
        }

        seed!: () => Promise<boolean>

        abstract run(_ctx: ActionContext): Promise<boolean> | boolean
    }

    return CommandMixinClass
}


