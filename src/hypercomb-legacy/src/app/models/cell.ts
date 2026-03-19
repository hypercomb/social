// hypercomb-legacy/src/app/models/cell.ts

import { CellFlags } from "./cell-flags"
import { HashService } from "src/app/hive/storage/hash.service"

export class Cell extends CellFlags {

  // identity (always present)
  seed: string = ""

  // parent seed (optional)
  parentGene: string | null = null

  // readable properties
  name: string = ""
  link: string = ""

  // structural properties
  index: number = -1
  childCount?: number
  imageHash?: string

  // layout
  backgroundColor = ""
  borderColor = "#222"
  scale = 1
  x = 0
  y = 0

  // timeline (optional, filesystem is truth)
  dateCreated?: string
  updatedAt?: string

  constructor(params: Partial<Cell> = {}) {
    super()
    Object.assign(this, params)
  }

  // --------------------------------------------------------
  // explicit identity setter: name + parent → genes
  // --------------------------------------------------------
  public async set(name: string, parent: string): Promise<void> {
    this.name = name ?? ""
    this.parentGene = parent ? await HashService.hash(parent) : null
    this.seed = await HashService.hash(this.name)
  }
}
