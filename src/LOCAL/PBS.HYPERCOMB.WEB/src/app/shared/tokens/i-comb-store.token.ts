import { InjectionToken, Signal } from "@angular/core"
import { Point } from "pixi.js"
import { Cell } from "src/app/cells/cell"
import { Tile } from "src/app/cells/models/tile"

/**
 * IStaging
 * manages in-memory cell staging for the active hive
 */
export interface IStaging {
  invalidateTile(cellId: number): void
  stageCells(cells: Cell[]): void
  stageAdd(cell: Cell): void
  stageRemove(cellId: number): void
  stageReplace(cell: Cell): void
  stageMerge(cells: Cell[]): void
}

/**
 * ICombStore
 * runtime store for tiles, cells, and reactive surface management
 * (single-hive version)
 */
export interface ICombStore {
  setVisibility(cells: Cell[] | Cell, visible: boolean): unknown
  filteredCells: Signal<Cell[]>

  lookupCellByIndex(idx: number): Cell | undefined
  // flush queues for scheduler
  flush: () => { hot: Cell[]; cold: Cell[] }
  enqueueHot(cells: Cell | Cell[]): void
  enqueueCold(cells: Cell | Cell[]): void

  // registry and lookup
  lookupTile(cellId: number): Tile | undefined
  lookupTileByIndex(index: number): Tile | undefined
  lookupData(cellId: number): Cell | undefined
  hasTile(cellId: number): boolean
  register(tile: Tile, cell: Cell): void
  unregister(cellId: number): void
  invalidate(): void

  // surface access (single hive only)
  cells: Signal<Cell[]>
  tiles: Signal<Tile[]>
  selectedCells: Signal<Cell[]>
  hasCells: Signal<boolean>
  size: Signal<number>

  // position/index updates
  updatePositionAndIndex(cellId: number, pos: Point, index?: number): void

  // reactive counters
  readonly flushSeq: Signal<number>
}

/**
 * Injection tokens
 */
export const STAGING_ST = new InjectionToken<IStaging>("STAGING_ST")
export const COMB_STORE = new InjectionToken<ICombStore>("COMB_STORE")
