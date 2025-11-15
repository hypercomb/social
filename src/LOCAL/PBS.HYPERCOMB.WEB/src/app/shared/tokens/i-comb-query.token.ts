import { InjectionToken } from "@angular/core"
import { Cell, Hive } from "src/app/cells/cell"
import { IDexieHive } from "src/app/hive/hive-models"

export interface ICombQueries {

    // bulk/context
    fetchAll(): Promise<Cell[]>

    // lookups
    fetch(cellId: number): Promise<Cell | undefined>
    fetchByIds(ids: number[]): Promise<Cell[]>
    fetchByUniqueId(uniqueId: string): Promise<Cell | null>
    fetchRoot(): Promise<Cell | undefined>

    // meta
    fetchCount(parent: Cell): Promise<number>
    exists(domain: Cell): Promise<boolean>
}

// --------------------
// query: read-only selectors
// --------------------
export interface IQueryHives {
    fetchHive(): Promise<Hive | undefined>
}


export const QUERY_COMB_SVC = new InjectionToken<ICombQueries>('QUERY_COMB_SVC')
export const QUERY_HIVE_SVC = new InjectionToken<IQueryHives>('QUERY_HIVE_SVC')
