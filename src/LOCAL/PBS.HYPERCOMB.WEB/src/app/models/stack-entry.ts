import { Cell } from "../cells/cell"

export class StackEntry {
  public readonly cellId: number
  public readonly hive: string
  public cell?: Cell
  public ready = false

  constructor(cellId: number, hive: string, cell?: Cell) {
    this.cellId = cellId
    this.hive = hive
    if (cell) this.hydrate(cell)
  }

  hydrate(cell: Cell) {
    if (cell.cellId !== this.cellId) throw new Error("cellId mismatch")
    this.cell = cell
    this.ready = true
  }
}
