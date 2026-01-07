// src/app/cells/models/hive-portal.ts
import { Cell } from "./cell"

export class HivePortal extends Cell {

  constructor(seed: string, name: string) {
    super({
      seed,
      parentGene: null,
      name
    })
  }
}
