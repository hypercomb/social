import { InjectionToken } from "@angular/core"
import { Cell, Hive } from "src/app/cells/cell"

// --------------------------------------------------------------
// READ-ONLY CELL QUERIES (repository only)
// --------------------------------------------------------------
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
  exists(cell: Cell): Promise<boolean>
}

// --------------------------------------------------------------
// READ-ONLY HIVE QUERY
// (typically wraps the HiveStore or OpfsHiveService)
// --------------------------------------------------------------
export interface IQueryHives {
  fetchHive(): Promise<Hive | undefined>
}

// injection tokens
export const QUERY_COMB_SVC = new InjectionToken<ICombQueries>('QUERY_COMB_SVC')
export const QUERY_HIVE_SVC = new InjectionToken<IQueryHives>('QUERY_HIVE_SVC')
