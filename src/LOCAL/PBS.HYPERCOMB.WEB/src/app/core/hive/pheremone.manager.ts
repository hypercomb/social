// src/app/core/hive/pheromone.manager.ts
import { inject } from '@angular/core'
import { IPheromoneManager, Seed, IStrand, StrandOp } from './i-dna.token'
import { StrandManager } from './strand-manager'
import { Hypercomb } from '../mixins/abstraction/hypercomb.base'

/*
pheromone manager
- consumes the full strand history for a lineage
- reduces only add-pheromone / remove-pheromone ops
- pheromones are signals/markers, not structure
- existence is symbolic; resolution is optional
*/

export class PheromoneManager extends Hypercomb implements IPheromoneManager {
  private readonly strandmgr = inject(StrandManager)

  // returns visible pheromone seeds at the given lineage
  public list = async (lineage: string): Promise<Seed[]> => {
    const strands = await this.strandmgr.list(lineage)
    return this.reduce(strands)
  }

  // appends a pheromone-related strand at the given lineage
  public add = async (lineage: string, seed: Seed): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    const strand: IStrand = { ordinal, seed, op: 'add-pheromone' }
    await this.strandmgr.add(lineage, strand)
  }

  public remove = async (lineage: string, seed: Seed): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    const strand: IStrand = { ordinal, seed, op: 'remove-pheromone' }
    await this.strandmgr.add(lineage, strand)
  }

  // -------------------------
  // pure reduction (pheromone domain only)
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
    if (strand.op === 'add-pheromone') {
      map.set(strand.seed, true)
    }

    if (strand.op === 'remove-pheromone') {
      map.set(strand.seed, false)
    }
  }
}
