// src/app/shared/tokens/i-comb-store.token.ts
import { InjectionToken, Signal } from "@angular/core"
import { Point } from "pixi.js"
import { Tile } from "src/app/cells/models/tile"
import { Cell } from "src/app/models/cell"

export interface IStaging {
  enqueue(cell: Cell)
  stageCells(cells: Cell[]): void
  stageAdd(cell: Cell): void
  stageRemove(gene: string): void
  stageReplace(cell: Cell): void
  stageMerge(cells: Cell[]): void
}

export interface IHoneycombStore {
  filteredCells: Signal<Cell[]>

  // scheduler
  flush(): { hot: Cell[] }
  enqueue(cells: Cell | Cell[]): void

  // registry
  register(cell:Cell,tile: Tile): void
  unregister(cell:Cell): void  
  lookupTile(gene:string): Tile | undefined
  lookupData(gene:string): Cell | undefined
  
  // surface
  cells: Signal<Cell[]>
  tiles: Signal<Tile[]>
  selectedCells: Signal<Cell[]>
  size: Signal<number>

  // movement
  updatePositionAndIndex(gene: string, pos: Point, index?: number): void

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
export const HONEYCOMB_STORE = new InjectionToken<IHoneycombStore>("HONEYCOMB_STORE")
