// src/app/core/operations/operation.model.ts

import { DiamondCommit } from '../diamond-core/diamond-core.model'
import { OperationResult } from './operation-result.model'

export interface Operation {
  key: string
  canRun(commit: DiamondCommit): boolean
  run(commit: DiamondCommit): OperationResult | void
}
