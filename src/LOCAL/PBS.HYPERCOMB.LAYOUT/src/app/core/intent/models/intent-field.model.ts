// src/app/core/intent/models/intent-field.model.ts

export type IntentPlane = 'action' | 'object' | 'focus'
export type SafetyClass = 'safe' | 'restricted' | 'unsafe'

export interface IntentParticle {
  index: number
  value: string
  plane: IntentPlane
}

export interface IntentFieldSnapshot {
  raw: string
  normalized: string
  particles: IntentParticle[]
  createdAt: number
}
