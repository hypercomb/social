// src/app/core/hive/layer.manager.ts
import { inject } from '@angular/core'
import { ILayerManager, Seed, IStrand } from './i-dna.token'
import { StrandManager } from './strand-manager'
import { Hypercomb } from '../mixins/abstraction/hypercomb.base'

/*
layer manager (cell-only)
- owns add/remove cell existence
- hard-codes cell ops
- accepts actions authored upstream
- delegates persistence to strand manager
*/

export class LayerManager extends Hypercomb implements ILayerManager {
  private readonly strandmgr = inject(StrandManager)

  public cells = async (lineage: string): Promise<Seed[]> => {
    const strands = await this.strandmgr.list(lineage)
    return this.reduce(strands)
  }

  public add = async (lineage: string, seed: Seed, actions: string[] = []): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    const strand: IStrand = { ordinal, seed, op: 'add-cell' }
    await this.strandmgr.add(lineage, strand, ...actions)
  }

  public remove = async (lineage: string, seed: Seed, actions: string[] = []): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    const strand: IStrand = { ordinal, seed, op: 'remove-cell' }
    await this.strandmgr.add(lineage, strand, ...actions)
  }

  private reduce = (strands: IStrand[]): Seed[] => {
    const map = new Map<Seed, boolean>()

    for (const strand of strands) {
      if (strand.op === 'add-cell') map.set(strand.seed, true)
      if (strand.op === 'remove-cell') map.set(strand.seed, false)
    }

    return [...map.entries()].filter(([, visible]) => visible).map(([seed]) => seed)
  }
}
