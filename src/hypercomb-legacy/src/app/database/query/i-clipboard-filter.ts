import { Cell } from "src/app/models/cell-kind"

export interface IClipboardFilter {
  canFilter(): Promise<boolean>
  filter(entries: Cell[]): Promise<Cell[]>
}

