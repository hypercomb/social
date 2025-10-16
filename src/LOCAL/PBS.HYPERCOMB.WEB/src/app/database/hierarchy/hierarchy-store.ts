import { Injectable, signal, WritableSignal } from '@angular/core'
import { Cell } from 'src/app/cells/cell'

@Injectable({ providedIn: 'root' })
export class HierarchyStore {
    private readonly hierarchies = new Map<string, WritableSignal<Cell[]>>()

    private ensureSignal(key: string): WritableSignal<Cell[]> {
        let s = this.hierarchies.get(key)
        if (!s) {
            s = signal<Cell[]>([])
            this.hierarchies.set(key, s)
        }
        return s
    }

    public setHierarchy(hiveName: string, sourceId: number, items: Cell[]) {
        const key = `${hiveName}-${sourceId}`
        this.ensureSignal(key).set(items)
    }

    public getHierarchy(hiveName: string, sourceId: number): Cell[] {
        const key = `${hiveName}-${sourceId}`
        return this.hierarchies.get(key)?.() ?? []
    }
}


