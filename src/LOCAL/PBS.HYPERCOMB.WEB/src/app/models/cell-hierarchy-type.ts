// src/app/hierarchy/cell-hierarchy.type.ts

import { Cell } from "../cells/cell"

export interface CellHierarchy {
  cell: Cell
  children: CellHierarchy[]
}
