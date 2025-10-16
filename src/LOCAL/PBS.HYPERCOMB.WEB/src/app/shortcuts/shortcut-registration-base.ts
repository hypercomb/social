
import { DataServiceBase } from "../actions/service-base-classes"
import { ServiceBase } from "../core/mixins/abstraction/service-base"
import { PixiServiceBase } from "../pixi/pixi-service-base"
import { ShortcutMixin } from "./shortcut-mixin"

export abstract class ShortcutRegistrations
    extends ShortcutMixin(ServiceBase) { }

export abstract class ShortcutDataRegistrations
    extends ShortcutMixin(DataServiceBase) { }

export abstract class ShortcutPixiRegistrations
    extends ShortcutMixin(PixiServiceBase) { }


