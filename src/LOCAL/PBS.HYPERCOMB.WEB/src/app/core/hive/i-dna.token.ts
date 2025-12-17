// src/app/core/hive/i-dna.token.ts
import { InjectionToken } from '@angular/core'

export type Seed = string

// --------------------------------------------------
// strand operations (intent only)
// --------------------------------------------------
export type StrandOp =
  | 'add-cell'
  | 'remove-cell'
  | 'add-resource'
  | 'remove-resource'
  | 'add-pheromone'
  | 'remove-pheromone'

// --------------------------------------------------
// strand = immutable instruction
// --------------------------------------------------
export interface IStrand {
  ordinal: number
  seed: Seed
  op: StrandOp
}

// --------------------------------------------------
// strand persistence (append-only log)
// --------------------------------------------------
export interface IStrandManager {
  // saved at: <lineage>/<ordinal>-<seed>-<op>
  add(lineage: string, strand: IStrand): Promise<void>
  list(lineage: string): Promise<IStrand[]>
}

// --------------------------------------------------
// layer (cell) reducer
// --------------------------------------------------
export interface ILayerManager {
  // visible cell seeds at lineage
  cells(lineage: string): Promise<Seed[]>

  // append cell intent
  add(lineage: string, seed: Seed, op: 'add-cell' | 'remove-cell'): Promise<void>
}

// --------------------------------------------------
// resource reducer (symbolic markers)
// --------------------------------------------------
export interface IResourceManager {
  // visible resource seeds at lineage
  list(lineage: string): Promise<Seed[]>

  // append resource intent
  add(lineage: string, seed: Seed): Promise<void>
  remove(lineage: string, seed: Seed): Promise<void>
}

// --------------------------------------------------
// pheromone reducer (signals / annotations)
// --------------------------------------------------
export interface IPheromoneManager {
  // visible pheromone seeds at lineage
  list(lineage: string): Promise<Seed[]>

  // append pheromone intent
  add(lineage: string, seed: Seed): Promise<void>
  remove(lineage: string, seed: Seed): Promise<void>
}

// --------------------------------------------------
// hive = convenience adapter over root lineage
// --------------------------------------------------
export interface IHiveManager {
  add(seed: Seed): Promise<void>
  remove(seed: Seed): Promise<void>
  find(seed: Seed): Promise<Seed | null>
  exists(seed: Seed): Promise<boolean>
}

// --------------------------------------------------
// injection tokens
// --------------------------------------------------
export const HIVE_MANAGER = new InjectionToken<IHiveManager>('HIVE_MANAGER')
export const LAYER_MANAGER = new InjectionToken<ILayerManager>('LAYER_MANAGER')
export const STRAND_MANAGER = new InjectionToken<IStrandManager>('STRAND_MANAGER')
export const RESOURCE_MANAGER = new InjectionToken<IResourceManager>('RESOURCE_MANAGER')
export const PHEROMONE_MANAGER = new InjectionToken<IPheromoneManager>('PHEROMONE_MANAGER')
