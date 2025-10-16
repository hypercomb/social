import { inject } from "@angular/core"
import { HiveState } from "../../hive/hive-state"

export type AbstractCtor<T = object> = abstract new (...args: any[]) => T
export type Ctor<T = {}> = new (...args: any[]) => T


export function WithHiveState<TBase extends Ctor>(Base: TBase) {
    return class extends Base {
        public readonly hiveState = inject(HiveState)
    }
}
