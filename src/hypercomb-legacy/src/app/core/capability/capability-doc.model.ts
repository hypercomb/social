export interface CapabilityDoc {
  name: string
  description: string
  intentIds: string[]
  inputs: string[]
  outputs: string[]
  sideEffects: 'none' | 'read-only' | 'writes'
}
