// src/app/core/operations/impl/delete-cell.operation.ts

import { BatchOperation } from '../batch-operation.model'
import { DiamondCommit } from '../../diamond-core/diamond-core.model'

export class DeleteCellOperation implements BatchOperation {

  public key = 'delete.cell'
  public batch = true as const

  public canRun(commit: DiamondCommit): boolean {
    return !!commit.selection?.seeds?.length
  }

  public run(commit: DiamondCommit): void {
    // actual deletion handled per target by sink
  }
}
