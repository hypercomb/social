// src/app/core/supportive/supportive-operation.model.ts

import { DiamondCommit } from '../diamond-core/diamond-core.model'

export interface SupportiveOperation {
  appliesTo(operationKey: string): boolean
  apply(commit: DiamondCommit): DiamondCommit
}
