
import { HypercombData } from "../actions/hypercomb-data"
import { Hypercomb } from "../core/mixins/abstraction/hypercomb.base"
import { PixiServiceBase } from "../pixi/pixi-service-base"
import { ShortcutMixin } from "./shortcut-mixin"

export abstract class ShortcutRegistrations
    extends ShortcutMixin(Hypercomb) { }

export abstract class ShortcutDataRegistrations
    extends ShortcutMixin(HypercombData) { }

export abstract class   ShortcutPixiRegistrations
    extends ShortcutMixin(PixiServiceBase) { }


