// src/app/core/operations/operation-result.model.ts

import { IStrand } from '../hive/i-dna.token'

export interface OperationResult {
  // virtual strand produced by the operation (no IO)
  strand?: IStrand

  // active context effects (still allowed pre-commit)
  promoteActiveId?: string
  clearActive?: boolean
}
