// src/app/core/safety/operation-safety.model.ts

import { SafetyClass } from '../intent/models/intent-field.model'

export interface OperationSafetyOverride {
  operationKey: string
  safety: SafetyClass
  reason: string
}
