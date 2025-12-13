// src/app/cells/models/ghost.ts
import { Cell } from "./cell"

export class Ghost extends Cell {
  constructor(params: Partial<Cell> = {}) {
    super({  ...params })
  }
}
