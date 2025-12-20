// src/app/core/diamond-core/segment.model.ts

import { IStrand } from '../hive/i-dna.token'

export interface Segment {
  lineage: string
  strands: IStrand[]
  createdAt: number
}
