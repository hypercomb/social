// src/app/core/intent/models/intent-field.model.ts

import { IntentPlane, Intent } from './intent.model'

export type SafetyClass = 'safe' | 'restricted' | 'unsafe'

export interface IntentParticle {
  intent: Intent
  plane: IntentPlane
  weight: number
  safetyClass: SafetyClass
  source: 'mouse' | 'keyboard' | 'gesture' | 'programmatic'
  ageMs: number
  lastUpdated: number
}

export interface IntentFieldSnapshot {
  particles: IntentParticle[]
  pendingBridge: boolean
  timestamp: number
}
