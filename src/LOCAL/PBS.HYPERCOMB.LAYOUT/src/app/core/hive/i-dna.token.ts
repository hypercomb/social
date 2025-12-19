// src/app/core/hive/i-dna.token.ts

import { InjectionToken } from '@angular/core'

export type Seed = string

// signature = what (noun-only) for resource payloads
export type Signature =
  | { kind: 'cell' }
  | { kind: 'text' }
  | { kind: 'image' }
  | { kind: 'link' }
  | { kind: 'container' }
  | { kind: 'executable' }

// strand op = verb-only
export type StrandOp =
  | 'add.cell'
  | 'remove.cell'
  | 'add.capability'
  | 'remove.capability'

// strand = immutable event (identity-only)
export interface IStrand {
  ordinal: number
  seed: Seed
  op: StrandOp
}

export interface IStrandManager {
  add(lineage: string, strand: IStrand, ...capabilities: string[]): Promise<void>
  list(lineage: string): Promise<IStrand[]>
}

export interface ILayerManager {
  cells(lineage: string): Promise<Seed[]>
  add(lineage: string, seed: Seed, capabilities?: string[]): Promise<void>
  remove(lineage: string, seed: Seed, capabilities?: string[]): Promise<void>
}

export interface IHiveManager {
  hives(): Promise<Seed[]>
  add(seed: Seed): Promise<void>
  remove(seed: Seed): Promise<void>
  exists(seed: Seed): Promise<boolean>
  find(seed: Seed): Promise<Seed | null>
}

// staged resource payload (signature belongs here)
export interface StagedResource {
  signature: Signature
  data: Blob | string
}

// injection tokens
export const STRAND_MANAGER = new InjectionToken<IStrandManager>('STRAND_MANAGER')
export const LAYER_MANAGER = new InjectionToken<ILayerManager>('LAYER_MANAGER')
export const HIVE_MANAGER = new InjectionToken<IHiveManager>('HIVE_MANAGER')
