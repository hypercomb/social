// src/app/core/diamond-core/diamond-core.model.ts

import { IntentFieldContext } from '../intent/models/intent-field-content.model'
import { SelectionContext } from '../selection/selection-context.model'
import { SafetyClass } from '../intent/models/intent-field.model'

export interface DiamondCommit {
  lineage: string
  intent: IntentFieldContext
  selection?: SelectionContext

  // resolved during processing, not required at creation
  safety?: SafetyClass
}
