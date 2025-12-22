// src/app/core/diamond-core/diamond-decision.model.ts

import { IntentFieldContext } from '../intent/models/intent-field-content.model'
import { SelectionContext } from '../selection/selection-context.model'
import { SafetyClass } from '../intent/models/intent-field.model'

export interface DiamondDecision {
  lineage: string
  intent: IntentFieldContext
  selection?: SelectionContext
  safety: SafetyClass
}
