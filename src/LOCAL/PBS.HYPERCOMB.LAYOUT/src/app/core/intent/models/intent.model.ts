// src/app/core/intent/models/intent.model.ts

export type IntentPlane =
  | 'action'
  | 'object'
  | 'focus'
  | 'control'
  | 'safety'

export interface Intent {
  // opaque, capability-defined
  key: string
  confidence: number
}
