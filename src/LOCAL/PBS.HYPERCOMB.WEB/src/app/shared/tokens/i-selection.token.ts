import { InjectionToken, Signal } from "@angular/core"
import { Cell } from "src/app/cells/cell"

export interface ISelections {
  clear(): void
  add(cell: Cell): void
  remove(cell: Cell): void
  toggle(cell: Cell): void
  items: Signal<Cell[]>
  canSelect: Signal<boolean>
}

export const SELECTIONS = new InjectionToken<ISelections>('SELECTIONS')
