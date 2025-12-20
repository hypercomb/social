// src/app/core/intent/models/intent-exec.model.ts

import { Intent } from './intent.model'
import { IStrand } from '../../hive/i-dna.token'

export interface DiamondDecision {
  winner: Intent | null
  reason: string
}

// retained only as a data carrier if needed later
export interface ResolvedIntent {
  strand: IStrand
}
