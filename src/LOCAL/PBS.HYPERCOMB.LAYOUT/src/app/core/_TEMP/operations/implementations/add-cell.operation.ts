// src/app/core/operations/impl/add-cell.operation.ts

import { Operation } from '../operation.model'
import { DiamondCommit } from '../../diamond-core/diamond-core.model'

export class AddCellOperation implements Operation {

  public key = 'add.cell'

  public canRun(_commit: DiamondCommit): boolean {
    return true
  }

  public run(commit: DiamondCommit) {
    // domain logic goes here
    // create cell, persist strand, etc.

    return {
      promoteActiveId: 'new-cell-id'
    }
  }
}
