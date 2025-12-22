// src/app/core/safety/operation-safety.registry.ts

import { OperationSafetyOverride } from './operation-safety.model'

export const OPERATION_SAFETY_OVERRIDES: OperationSafetyOverride[] = [
  {
    operationKey: 'publish.hive',
    safety: 'restricted',
    reason: 'publishing is irreversible'
  },
  {
    operationKey: 'delete.hive',
    safety: 'unsafe',
    reason: 'destructive and irreversible'
  }
]
