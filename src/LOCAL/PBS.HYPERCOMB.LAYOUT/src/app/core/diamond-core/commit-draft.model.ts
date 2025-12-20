// src/app/core/diamond-core/commit-draft.model.ts

import { IntentFieldContext } from '../intent/models/intent-field-content.model'
import { SelectionContext } from '../selection/selection-context.model'

export interface CommitDraft {
  lineage: string
  intent: IntentFieldContext
  selection?: SelectionContext
}
