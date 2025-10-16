import { inject } from '@angular/core'
import { MODIFY_HIVES, QUERY_HIVES } from 'src/app/shared/tokens/i-hive-store.token'
import { QUERY_CELL_SVC, COMB_SERVICE } from 'src/app/shared/tokens/i-comb-store.token'
import { AbstractCtor } from '../core/mixins/mixin-helpers'

export function StoreAccessMixin<TBase extends AbstractCtor>(Base: TBase) {
    abstract class Mixin extends Base {
        protected mutate = {
            cells: inject(COMB_SERVICE),
            hives: inject(MODIFY_HIVES)
        }
        protected readonly query = {
            cells: inject(QUERY_CELL_SVC),
            hives: inject(QUERY_HIVES)
        }

    }
    return Mixin as unknown as AbstractCtor<InstanceType<TBase> & Mixin>
}
