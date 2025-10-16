import { Cell } from "src/app/cells/cell"

export interface IClipboardFilter {
  canFilter(): Promise<boolean>
  filter(entries: Cell[]): Promise<Cell[]>
}

