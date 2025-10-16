// service-mixin.ts

import { inject, Injector } from '@angular/core'
import { Container } from 'pixi.js'
import { DebugService } from '../../diagnostics/debug-service'
import { EventDispatcher } from '../../../helper/events/event-dispatcher'
import { ContextStack } from '../../../unsorted/controller/context-stack'
import { KeyboardState } from '../../../interactivity/keyboard/keyboard-state'
import { HypercombState } from '../../../state/core/hypercomb-state'
import { LayoutState } from '../../../layout/layout-state'
import { Settings } from '../../../unsorted/settings'
import { HiveState } from 'src/app/hive/hive-state'
import { AbstractCtor } from 'src/app/core/mixins/mixin-helpers'
import { PolicyService } from 'src/app/navigation/menus/policy-service'
import { ContextMenuService } from 'src/app/navigation/menus/context-menu-service'
import { PointerState } from 'src/app/state/input/pointer-state'
import { TILE_SERVICE } from 'src/app/shared/tokens/i-hypercomb.token'
import { CoordinateDetector } from 'src/app/helper/detection/coordinate-detector'
import { HIVE_HYDRATION, MODIFY_COMB_SVC } from 'src/app/shared/tokens/i-comb-service.token'
import { STAGING_ST } from 'src/app/shared/tokens/i-comb-store.token'

export function ServiceMixin<TBase extends AbstractCtor>(Base: TBase) {
    abstract class ServiceMixinClass extends Base {
        public readonly injector = inject(Injector)
        protected readonly debug = inject(DebugService)


        private _HypercombState?: HypercombState
        public get state(): HypercombState {
            return this._HypercombState ??= this.injector.get(HypercombState)
        }

        private _contextStack?: ContextStack
        public get stack(): ContextStack {
            return this._contextStack ??= this.injector.get(ContextStack)
        }

        private _hs?: HiveState
        public get hs(): HiveState {
            return this._hs ??= this.injector.get(HiveState)
        }

        private _layoutState?: LayoutState
        public get ls(): LayoutState {
            return this._layoutState ??= this.injector.get(LayoutState)
        }

        private _policyService?: PolicyService
        public get policy(): PolicyService {
            return this._policyService ??= this.injector.get(PolicyService)
        }

        private _settings?: Settings
        public get settings(): Settings {
            return this._settings ??= this.injector.get(Settings)
        }

        private _keyboardState?: KeyboardState
        public get ks(): KeyboardState {
            return this._keyboardState ??= this.injector.get(KeyboardState)
        }

        private _events?: EventDispatcher
        protected get events(): EventDispatcher {
            return this._events ??= this.injector.get(EventDispatcher)
        }

        public get window(): Window {
            return window
        }
    }

    // ðŸ‘‡ cast through unknown so TS doesn't complain about constructor compatibility
    return ServiceMixinClass as unknown as AbstractCtor<InstanceType<TBase> & ServiceMixinClass>
}

// expose a concrete base so you don't have to re-mixin everywhere
export abstract class ServiceBase extends ServiceMixin(class { }) { }

export abstract class LayoutServiceBase extends ServiceMixin(class { }) {
    protected readonly ps = inject(PointerState)
    protected readonly detector = inject(CoordinateDetector)
    protected readonly comb = { 
        modify: inject(MODIFY_COMB_SVC)
    }
    protected readonly hydration = inject(HIVE_HYDRATION)
    protected readonly staging = inject(STAGING_ST)
}
