import { Injectable, inject } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { combId, sourceKey } from "src/app/cells/models/cell-filters"
import { HypercombMode } from "src/app/core/models/enumerations"
import { COMB_SERVICE } from "src/app/shared/tokens/i-comb-service.token"
import { PointerState } from "src/app/state/input/pointer-state"
import { ClipboardOperation } from "./clipboard-operation"

@Injectable({ providedIn: 'root' })
export class PasteService extends ClipboardOperation {
    private readonly store = { query: inject(QUERY_CELL_SVC), mutate: inject(COMB_SERVICE) }
    private readonly ps = inject(PointerState)


    constructor() {
        super()
    }

    // -----------------------------------------------------------
    // command checks
    // -----------------------------------------------------------
    public canExecute = (): boolean =>
        this.state.hasMode(HypercombMode.ViewingClipboard) &&
        !this.state.hasMode(HypercombMode.Move) &&
        this.ks.primary()

    // -----------------------------------------------------------
    // execution
    // -----------------------------------------------------------
    public complete = async (cell: Cell, tileIndexes: number[]) => {
        // await this.cs.clean() // clear clipboard nav stack
        // const context = this.stack.current()
        // if (!context) return

        // const newHive = context.hive
        // const type = HoneycombType.Default

        // // fetch + map items (hydrate via store)
        // const data = await this.store.query.fetchByHive(cell.hive)
        // if (!data?.length) return
        // const mapped = this.getMappedItems(data)

        // const first = data.find(x => x.cellId === cell.cellId)
        // if (!first) return

        // // pick index
        // let index = first.previousIndex ?? 0
        // if (tileIndexes.includes(index)) {
        //     index = await this.honeycomb.findNextIndex(tileIndexes)
        // }
        // tileIndexes.push(index)

        // // seed root of paste tree
        // first.index = index
        // first.sourceId = context.cellId!

        // // rebuild hierarchy
        // const resultData: Cell[] = []
        // this.buildHierarchy(first, resultData, mapped)

        // // normalize hive + type
        // for (const x of resultData) {
        //     x.type = type
        //     x.hive = newHive
        // }

        // // persist via store (ensures signals stay in sync)
        // await this.store.mutate.bulkPut(resultData)

        // // clear from clipboard state
        // const items = this.clipboardState.items().filter(i => combId(i) !== combId(cell))
        // this.clipboardState.setItems(items)
    }

    // -----------------------------------------------------------
    // clipboard utilities
    // -----------------------------------------------------------
    public clearClipboardTiles = (cell: Cell | undefined): Cell | undefined => {
        // let guard = 0
        // let tile = cell
        // while (tile && tile.type === HoneycombType.Clipboard) {
        //     this.debug.log('clipboard', 'popping clipboard')
        //     this.cs.pop()
        //     tile = this.stack.current()
        //     if (++guard > 100) break // safety guard
        // }
        // return tile
    }

    private buildHierarchy = (cell: Cell, output: Cell[], map: Map<string, Cell[]>) => {
        output.push(cell)
        const children = map.get(combId(cell))
        children?.forEach(t => this.buildHierarchy(t, output, map))
    }

    private getMappedItems = (data: Cell[]): Map<string, Cell[]> => {
        return data.reduce((map, x) => {
            if (!map.has(sourceKey(x))) map.set(sourceKey(x), [])
            map.get(sourceKey(x))!.push(x)
            return map
        }, new Map<string, Cell[]>())
    }
}


