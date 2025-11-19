import { Injectable, inject } from "@angular/core"
import { CellFactory } from "../inversion-of-control/factory/cell-factory"
import { ClipboardStore } from "./clipboard-store"
import { Cell } from "../cells/cell"
import { MODIFY_COMB_SVC } from "../shared/tokens/i-comb-service.token"
import { CLIPBOARD_REPOSITORY } from "../shared/tokens/i-clipboard-repository"
import { CELL_REPOSITORY } from "../shared/tokens/i-cell-repository.token"
import { IHiveImage } from "../core/models/i-hive-image"

@Injectable({ providedIn: "root" })
export class ClipboardService {

    private comb = {
        repository: inject(CELL_REPOSITORY)
    }
    private readonly clipboard = {
        repository: inject(CLIPBOARD_REPOSITORY)
    }

    private readonly store = inject(ClipboardStore)
    private readonly modify = inject(MODIFY_COMB_SVC)
    private readonly factory = inject(CellFactory)

    /** select an active clipboard */
    public selectClipboard(cell: Cell) {
        this.store.setActive(cell)
    }

    public add = async (root: Cell): Promise<Cell> => {
        // const cell = await this.repository.add(root)!
        // console.assert(cell.cellId, "added clipboard must have cellId")
        // return cell
        throw new Error("Not implemented")
    }

    /** copy into active clipboard */
    public async copy(cell: Cell) {
        const active = this.store.activeClipboard()
        if (!active) return

        const clone = await this.factory.clone(cell, {
            hive: active.hive,
            sourceId: active.cellId!,
        })
        const { ...rest} = clone
        await this.modify.addCell(<Cell>rest)
        // children auto-refresh via ClipboardStore effect
    }

    public async fetchHierarchy(sourceId: number): Promise<Cell[]> {
        return this.clipboard.repository.fetchHierarchy(sourceId)
    }

}