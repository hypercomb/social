// src/app/workspace/workspace-service.ts
import { inject, Injectable } from '@angular/core'
import { Cell } from '../cells/cell'
import { WorkspaceBase } from './workplace-base'
import { HIVE_STORE } from '../shared/tokens/i-hive-store.token'
import { COMB_STORE } from '../shared/tokens/i-comb-store.token'
import { context } from '../state/interactivity/context-cell'

@Injectable({ providedIn: 'root' })
export class Workspace extends WorkspaceBase {
    private readonly store = {
        hive: inject(HIVE_STORE),
        comb: inject(COMB_STORE)
    }

    // -----------------------------------------------------------
    // hive/comb navigation (state only; no repo calls)
    // -----------------------------------------------------------
    // note: this.cs is your CombState (owner of items/index/active)
    public nextHive = () => {
        this.store.hive.next()
    }

    public prevHive = () => {
        this.store.hive.prev()
    }

    // select by name (preferred since Hive model no longer exists)
    public selectHive = (hiveName: string) => {
        // const hive = this.store.hive.items().find(h => h.name === hiveName) || null
        // this.store.hive.setActive(hive)
    }

    public selectHiveByIndex = (i: number) => {
        this.store.hive.setActiveByIndex(i)
    }

    // -----------------------------------------------------------
    // tile flows (store + orchestration)
    // -----------------------------------------------------------


    public addCell = async (cell: Cell) => {
        const persisted = await this.mutate.addCell(cell)
        this.store.comb.enqueueHot(persisted)
    }

    public removeCell = async (cell: Cell) => {
        await this.mutate.removeCell(cell)
        this.store.comb.enqueueCold(cell)
    }

    public updateCell = async (cell: Cell, targetHiveName?: string) => {
        // persist first
        await this.mutate.updateCell(cell)

        // follow-up action based on hive move vs in-place change
        const moved = !!targetHiveName && targetHiveName !== cell.hive
        moved
            ? this.mutate.moveCell(targetHiveName!, cell)
            : this.mutate.replaceCell(cell.hive, cell)

        // enqueue for render/update
        this.store.comb.enqueueHot(cell)
    }

    // -----------------------------------------------------------
    // loading helpers
    // -----------------------------------------------------------
    // kept name for compatibility; uses active comb state under the hood
    public loadTilesForActiveHive = async (): Promise<Cell[]> => {
        const active = context.hive()

        if (!active) return []
        return this.query.fetchByHive(active.name)
    }
}
