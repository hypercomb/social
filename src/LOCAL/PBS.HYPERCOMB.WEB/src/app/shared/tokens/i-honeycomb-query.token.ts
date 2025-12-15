import { InjectionToken } from "@angular/core"
import { Cell } from "src/app/models/cell"

// --------------------------------------------------------------
// READ-ONLY CELL QUERIES (repository only)
// --------------------------------------------------------------
export interface ICombQueries {

  // bulk/context
  fetchAll(): Promise<Cell[]>

  // lookups
  fetch(gene: string): Promise<Cell | undefined>
  fetchByIds(ids: number[]): Promise<Cell[]>

  // meta
  fetchCount(parent: Cell): Promise<number>
  exists(cell: Cell): Promise<boolean>
}

// injection tokens
export const QUERY_COMB_SVC = new InjectionToken<ICombQueries>('QUERY_COMB_SVC')
