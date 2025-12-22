import { Vector } from './vector'

export interface Nucleotide {
  id: string
  fromCellId: string
  toCellId: string
  vector: Vector
  depth: number
  timestamp: number
}
