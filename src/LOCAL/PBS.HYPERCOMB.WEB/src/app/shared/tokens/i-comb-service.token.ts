import { InjectionToken, Signal } from "@angular/core"
import { Cell, CellKind, NewCell } from "src/app/cells/cell"
import { IHiveImage } from "src/app/core/models/i-hive-image"

export interface ICombState {
    selectedCells: Signal<Cell[]>
}

export interface IModifyComb {
    updateSilent(cell: Cell)
    create(params: Partial<NewCell>, kind: CellKind): Promise<Cell>
    deleteAll(cell: Cell, hierarchy: Cell[]): Promise<void>
    bulkPut(dataArray: Cell[])
    addCell(newCell: NewCell, image:IHiveImage): Promise<Cell>
    updateCell(cell: Cell): Promise<number>
    removeCell(cell: Cell): Promise<void>
}

export interface IHiveHydration {
    invalidate(): void
    invalidateTile(cellId: number): void
    reset()
    ready: Signal<boolean>
    setReady()
    flush(): { hot: any; cold: any }
    isFetching(hive: string): boolean
    markFetching(hive: string): void
    resetHydration(hive: string): void
    isHydrated(hive: string): boolean
    markHydrated(hive: string): void
}

export interface ICellService extends ICombState, IHiveHydration { }

export const MODIFY_COMB_SVC = new InjectionToken<IModifyComb>('MODIFY_COMB_SVC')
export const HONEYCOMB_SVC = new InjectionToken<ICellService>('HONEYCOMB_SVC')
export const HIVE_HYDRATION = new InjectionToken<IHiveHydration>('HIVE_HYDRATION')