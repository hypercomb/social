// src/app/inversion-of-control/factory/cell-builder.ts

import { inject, Injectable } from '@angular/core'
import { ParentContext } from 'src/app/core/controller/context-stack'
import { Cell } from 'src/app/models/cell'
import { HashService } from 'src/app/hive/storage/hash.service'
import { CellResolver } from 'src/app/core/mappers/to-cell'
import { SeedVault } from 'src/app/core/hive/seed-vault'
import { CELL_BUILDER, IBuildCells } from '../tokens/tile-factory.token'

@Injectable({ providedIn: 'root' })
export class CellBuilder implements IBuildCells {
  private readonly stack = inject(ParentContext)
  private readonly builder = inject<IBuildCells>(CELL_BUILDER)

  // introduces a new cell into the hive (intent → identity)
  public async build(name: string): Promise<Cell> {
    const seed = await HashService.hash(name)
    const parent = this.stack.seed()!

    // dna / lineage creation belongs here
    // example: genome.add(seed, parent)

    // materialize after creation
    return this.builder.build(seed)
  }
}
