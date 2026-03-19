// hypercomb-legacy/src/app/models/ghost-cell.ts

import { Cell } from "./cell"

export class Ghost extends Cell {
  constructor(params: Partial<Cell> = {}) {
    super({  ...params })
  }
}
