// src/app/core/hive/i-dna.token.ts
import { InjectionToken } from '@angular/core'
import { Signature } from 'src/app/hive/storage/hash.service'


export type Seed = string

// strand operations (intent only)
// expected filename: 00000001-64hexhash-add-cell
export type StrandOp =
  | 'add-cell'
  | 'remove-cell'
  | 'add-action'
  | 'remove-action'
  | 'add-pheromone'
  | 'remove-pheromone'


// strand = immutable instruction header (payload is params stream)
export interface IStrand {
  ordinal: number
  seed: Seed
  op: StrandOp
}

// strand persistence (append-only log)
export interface IStrandManager {
  // saved at: <lineage>/<ordinal>-<seed>-<op>
  // payload = newline-delimited JSON of StrandParam[]
  add(
    lineage: string,
    strand: IStrand,
    ...actions: string[]
  ): Promise<void>

  list(lineage: string): Promise<IStrand[]>
}

// layer (cell) reducer
export interface ILayerManager {
  cells(lineage: string): Promise<Seed[]>
  add(lineage: string, seed: Seed, actions?: string[]): Promise<void>
  remove(lineage: string, seed: Seed, actions?: string[]): Promise<void>
}

// resource reducer (symbolic markers)
export interface IResourceManager {
  list(lineage: string): Promise<Seed[]>
  add(lineage: string, seed: Seed): Promise<void>
  remove(lineage: string, seed: Seed): Promise<void>
}

// pheromone reducer (signals / annotations)
export interface IPheromoneManager {
  list(lineage: string): Promise<Seed[]>
  add(lineage: string, seed: Seed): Promise<void>
  remove(lineage: string, seed: Seed): Promise<void>
}

// hive = convenience adapter over root lineage
export interface IHiveManager {
  add(seed: Seed): Promise<void>
  remove(seed: Seed): Promise<void>
  find(seed: Seed): Promise<Seed | null>
  exists(seed: Seed): Promise<boolean>
}

// -----------------------------------------------------
// staged resource (instruction payload or artifact)
// -----------------------------------------------------
export interface StagedResource {
  signature: Signature
  data: Blob | string
}

// injection tokens
export const HIVE_MANAGER = new InjectionToken<IHiveManager>('HIVE_MANAGER')
export const LAYER_MANAGER = new InjectionToken<ILayerManager>('LAYER_MANAGER')
export const STRAND_MANAGER = new InjectionToken<IStrandManager>('STRAND_MANAGER')
export const RESOURCE_MANAGER = new InjectionToken<IResourceManager>('RESOURCE_MANAGER')
export const PHEROMONE_MANAGER = new InjectionToken<IPheromoneManager>('PHEROMONE_MANAGER')
