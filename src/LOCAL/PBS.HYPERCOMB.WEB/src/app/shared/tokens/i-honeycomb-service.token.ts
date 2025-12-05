// src/app/shared/tokens/i-comb-service.token.ts
import { InjectionToken, Signal } from "@angular/core"
import { Cell, CellKind, NewCell } from "src/app/cells/cell"

export interface ICombState {
  selectedCells: Signal<Cell[]>
}

export interface IModifyComb {
  updateHasChildren(cell: Cell): unknown
  updateSilent(cell: Cell): Promise<number>
  create(params: Partial<NewCell>, kind: CellKind): Promise<Cell>
  deleteAll(cell: Cell, hierarchy: Cell[]): Promise<void>
  bulkPut(dataArray: Cell[]): Promise<void>
  addCell(newCell: NewCell): Promise<Cell>
  updateCell(cell: Cell): Promise<number>
  removeCell(cell: Cell): Promise<void>
}

export interface IHiveHydration {
  reset(): void
  ready: Signal<boolean>
  setReady(): void
  flush(): { hot: any }
  

  // ---------------------------------------------------------
  // LEGACY COMPATIBILITY
  // ---------------------------------------------------------
  invalidate(): void
  invalidateTile(cellId: number): void
}

export interface ICellService extends ICombState, IHiveHydration { }

export const MODIFY_COMB_SVC = new InjectionToken<IModifyComb>("MODIFY_COMB_SVC")
export const HONEYCOMB_SVC = new InjectionToken<ICellService>("HONEYCOMB_SVC")
export const HIVE_HYDRATION = new InjectionToken<IHiveHydration>("HIVE_HYDRATION")
