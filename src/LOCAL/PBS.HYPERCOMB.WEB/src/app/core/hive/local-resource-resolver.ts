// src/app/core/hive/local-resource.resolver.ts

import { inject } from '@angular/core'
import { IResourceManager, Seed, IStrand } from './i-dna.token'
import { StrandManager } from './strand-manager'
import { Hypercomb } from '../mixins/abstraction/hypercomb.base'
import { RESOURCE_RESOLVERS, IResourceResolver } from './resource-resolvers.token'

/*
local resource resolver
-----------------------
- consumes the full strand history for a lineage
- reduces only add-resource / remove-resource ops
- resources are symbolic markers (existence optional)
- no filesystem resolution here
- delegates actual resolution to registered resolvers
*/

export class LocalResourceResolver extends Hypercomb implements IResourceManager {
  private readonly strandmgr = inject(StrandManager)
  private readonly resolvers =
    inject(RESOURCE_RESOLVERS, { optional: true }) ?? []

  // returns visible resource seeds at the given lineage
  public list = async (lineage: string): Promise<Seed[]> => {
    const strands = await this.strandmgr.list(lineage)
    return this.reduce(strands)
  }

  // resolves visible resources using registered resolvers
  public resolve = async (lineage: string): Promise<void> => {
    const seeds = await this.list(lineage)

    for (const seed of seeds) {
      await this.resolveOne(seed, lineage)
    }
  }

  // appends a resource-related strand at the given lineage
  public add = async (lineage: string, seed: Seed): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    const strand: IStrand = { ordinal, seed, op: 'add-resource' }
    await this.strandmgr.add(lineage, strand)
  }

  public remove = async (lineage: string, seed: Seed): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    const strand: IStrand = { ordinal, seed, op: 'remove-resource' }
    await this.strandmgr.add(lineage, strand)
  }

  // -------------------------
  // resolution pipeline
  // -------------------------

  private resolveOne = async (seed: Seed, lineage: string): Promise<void> => {
    for (const resolver of this.resolvers) {
      const handled = await resolver.resolve(seed, lineage)
      if (handled) return
    }
    // intentionally silent if unhandled
  }

  // -------------------------
  // pure reduction (resource domain only)
  // -------------------------

  private reduce = (strands: IStrand[]): Seed[] => {
    const map = new Map<Seed, boolean>()

    for (const strand of strands) {
      this.apply(map, strand)
    }

    return [...map.entries()]
      .filter(([, visible]) => visible)
      .map(([seed]) => seed)
  }

  private apply = (map: Map<Seed, boolean>, strand: IStrand): void => {
    if (strand.op === 'add-resource') {
      map.set(strand.seed, true)
    }

    if (strand.op === 'remove-resource') {
      map.set(strand.seed, false)
    }
  }
}
