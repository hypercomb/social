import { AbstractCtor } from "../core/mixins/mixin-helpers"


// ShortcutMixin
export function ShortcutMixin<TBase extends AbstractCtor>(Base: TBase) {
    abstract class ShortcutMixinClass extends Base {
        // shortcut registry helpers
    }
    return ShortcutMixinClass as unknown as AbstractCtor<InstanceType<TBase>>
}

// CommandMixin
export function CommandMixin<TBase extends AbstractCtor>(Base: TBase) {
    abstract class CommandMixinClass extends Base {
        // command execution helpers
    }
    return CommandMixinClass as unknown as AbstractCtor<InstanceType<TBase>>
}


