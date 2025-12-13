// src/app/cells/models/hive-portal.ts
import { Cell } from "./cell"

export class HivePortal extends Cell {

  constructor(gene: string, name: string) {
    super({
      gene,
      parentGene: null,
      name
    })
  }
}
