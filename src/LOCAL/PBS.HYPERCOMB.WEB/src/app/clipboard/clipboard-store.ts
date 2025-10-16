import { Injectable, signal, computed, effect, inject } from "@angular/core"
import { Cell } from "../cells/cell"
import { IClipboardState } from "../shared/tokens/i-hypercomb.token"

@Injectable({ providedIn: "root" })
export class ClipboardStore implements IClipboardState {

    // --- signals ---------------------------------------------------------
    public readonly clipboards = signal<Cell[]>([])
    public readonly activeClipboard = signal<Cell | null>(null)
    public readonly activeItems = signal<Cell[]>([])

    public readonly hasClipboards = computed(() => this.clipboards().length > 0)
    public readonly hasActive = computed(() => !!this.activeClipboard())

    // --- mutators --------------------------------------------------------
    public setClipboards = (cells: Cell[]) => this.clipboards.set(cells)
    public setActive = (cell: Cell | null) => this.activeClipboard.set(cell)
    public clear = () => {
        this.clipboards.set([])
        this.activeClipboard.set(null)
        this.activeItems.set([])
    }

    // --- lifecycle -------------------------------------------------------
    constructor() {
        effect(async () => {
            const active = this.activeClipboard()
            if (!active) {
                this.activeItems.set([])
                return
            }

            // const children = await this.query.fetchHierarchy(active.hive, active.cellId!)
            // this.activeItems.set(children)
            throw new Error("Not implemented")
        })
    }
}
