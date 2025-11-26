// src/app/shared/tokens/i-comb-store.token.ts
import { InjectionToken, Signal } from "@angular/core"
import { Point } from "pixi.js"
import { Cell } from "src/app/cells/cell"
import { Tile } from "src/app/cells/models/tile"

export interface IStaging {
  stageCells(cells: Cell[]): void
  stageAdd(cell: Cell): void
  stageRemove(cellId: number): void
  stageReplace(cell: Cell): void
  stageMerge(cells: Cell[]): void
}

export interface ICombStore {
  filteredCells: Signal<Cell[]>

  // scheduler
  flush(): { hot: Cell[] }
  enqueueHot(cells: Cell | Cell[]): void

  // registry
  register(tile: Tile, cell: Cell): void
  unregister(cellId: number): void  
  lookupTile(cellId: number): Tile | undefined
  lookupData(cellId: number): Cell | undefined

  // surface
  cells: Signal<Cell[]>
  tiles: Signal<Tile[]>
  selectedCells: Signal<Cell[]>
  size: Signal<number>

  // movement
  updatePositionAndIndex(cellId: number, pos: Point, index?: number): void

  readonly flushSeq: Signal<number>

  // ---------------------------------------------------------
  // LEGACY COMPATIBILITY (still used across app)
  // ---------------------------------------------------------
  invalidate(): void
  hasCells(): boolean
  setVisibility(cells: Cell[] | Cell, visible: boolean): void
  lookupTileByIndex(index: number): Tile | undefined
  lookupCellByIndex(index: number): Cell | undefined
}

export const STAGING_ST = new InjectionToken<IStaging>("STAGING_ST")
export const COMB_STORE = new InjectionToken<ICombStore>("COMB_STORE")
