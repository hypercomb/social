// src/app/core/intent/models/intent-field-context.model.ts

import { CoreIntentPlane } from "./intent-field-plane.model"


export interface IntentFieldContext {
  dominantIntent?: string
  dominantPlane?: CoreIntentPlane
  dominantWeight?: number
}
