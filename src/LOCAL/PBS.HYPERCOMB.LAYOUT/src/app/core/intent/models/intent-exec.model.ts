import { Intent } from './intent.model'
import { StrandOp } from '../../hive/i-dna.token'

export interface SemanticResolution {
  executable: boolean
  op?: StrandOp
  object?: string
  confidence: number
}

export interface DiamondDecision {
  winner: Intent | null
  reason: string
}

export interface ResolvedIntent {
  op: StrandOp
  seed: string
  lineage: string
}
