interface SafetyDecision {
  timestamp: number
  lineage: string
  safety: 'safe' | 'restricted' | 'unsafe'
  allowed: boolean
  elevationActive: boolean
  reason: string
}
