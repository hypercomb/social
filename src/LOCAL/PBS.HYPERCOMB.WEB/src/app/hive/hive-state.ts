
import { Injectable, signal, computed } from "@angular/core"
import { Hive } from "../cells/cell"

@Injectable({ providedIn: 'root' })
// deprecated: remove once comb migration is complete.
export class HiveState {

    private readonly _hives = signal<Hive[]>([])
    public readonly hives = this._hives.asReadonly()

    private readonly _activeIndex = signal<number>(0)
    public readonly activeIndex = this._activeIndex.asReadonly()

    public readonly activeHive = computed(() => {
        const list = this._hives()
        const idx = this._activeIndex()
        return list.length > 0 ? list[idx % list.length] : null
    })

    private readonly _lastCreated = signal<Hive | null>(null)
    public readonly lastCreated = this._lastCreated.asReadonly()

    public resetIndex() {
        this._activeIndex.set(0)
    }

    public setHives(hives: Hive[]) {
        this._hives.set(hives)
        if (this._activeIndex() >= hives.length) {
            this._activeIndex.set(0)
        }
    }

    public setIndex(index: number) {
        this._activeIndex.set(index)
    }

    public setLastCreated(hive: Hive) {
        this._lastCreated.set(hive)
    }

    public resetLastCreated() {
        this._lastCreated.set(null)
    }
}


