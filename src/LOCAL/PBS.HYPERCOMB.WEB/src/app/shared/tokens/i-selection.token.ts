import { InjectionToken, Signal } from "@angular/core"
import { Cell } from "src/app/cells/cell"

export interface ISelections {
  beginSelection(): void
  finishSelection(): void
  clear(): void
  add(cell: Cell): void
  remove(cell: Cell): void

  suppressNextUp: Signal<boolean>
  isSelecting: Signal<boolean>
  items: Signal<Cell[]>
  canSelect: Signal<boolean>
}

export const SELECTIONS = new InjectionToken<ISelections>('SELECTIONS')
