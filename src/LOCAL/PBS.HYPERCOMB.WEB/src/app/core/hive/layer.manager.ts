// src/app/core/hive/layer.manager.ts
import { inject } from '@angular/core'
import { ILayerManager, Seed, IStrand, StrandOp } from './i-dna.token'
import { StrandManager } from './strand-manager'
import { Hypercomb } from '../mixins/abstraction/hypercomb.base'

/*
layer manager (cell-only)
- consumes the full strand history for a lineage
- reduces only add-cell / remove-cell ops
- ignores all other intents (resources, pheromones, future ops)
- produces the visible set of cell seeds
*/

export class LayerManager extends Hypercomb implements ILayerManager {
  private readonly strandmgr = inject(StrandManager)

  // returns visible cell seeds at the given lineage
  public cells = async (lineage: string): Promise<Seed[]> => {
    const strands = await this.strandmgr.list(lineage)
    return this.reduce(strands)
  }

  // appends a cell-related strand at the given lineage
  public add = async (lineage: string, seed: Seed, op: StrandOp): Promise<void> => {
    // only cell ops are meaningful here
    if (op !== 'add-cell' && op !== 'remove-cell') return

    const ordinal = (await this.strandmgr.list(lineage)).length
    const strand: IStrand = { ordinal, seed, op }
    await this.strandmgr.add(lineage, strand)
  }

  // -------------------------
  // pure reduction (cell domain only)
  // -------------------------
  public reduce = (strands: IStrand[]): Seed[] => {
    const map = new Map<Seed, boolean>()

    for (const strand of strands) {
      this.apply(map, strand)
    }

    return [...map.entries()]
      .filter(([, visible]) => visible)
      .map(([seed]) => seed)
  }

  private apply = (map: Map<Seed, boolean>, strand: IStrand): void => {
    if (strand.op === 'add-cell') {
      map.set(strand.seed, true)
    }

    if (strand.op === 'remove-cell') {
      map.set(strand.seed, false)
    }
  }
}
