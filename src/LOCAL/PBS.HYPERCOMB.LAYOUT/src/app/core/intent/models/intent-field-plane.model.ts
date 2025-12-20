export type CoreIntentPlane =
    | 'action'
    | 'object'
    | 'focus'

// src/app/core/intent/models/intent-field-plane.model.ts
export type IntentFieldPlane =
    | CoreIntentPlane
    | 'control'
    | 'safety'
