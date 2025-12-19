// src/app/core/hive/layer.manager.ts

import { inject } from '@angular/core'
import { ILayerManager, IStrand, Seed } from './i-dna.token'
import { Hypercomb } from '../hypercomb.base'
import { StrandManager } from './strand.manager'

export class LayerManager extends Hypercomb implements ILayerManager {
  private readonly strandmgr = inject(StrandManager)

  public cells = async (lineage: string): Promise<Seed[]> => {
    const strands = await this.strandmgr.list(lineage)
    return this.reduce(strands)
  }

  public add = async (lineage: string, seed: Seed, capabilities: string[] = []): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    await this.strandmgr.add(lineage, { ordinal, seed, op: 'add.cell' }, ...capabilities)
  }

  public remove = async (lineage: string, seed: Seed, capabilities: string[] = []): Promise<void> => {
    const ordinal = (await this.strandmgr.list(lineage)).length
    await this.strandmgr.add(lineage, { ordinal, seed, op: 'remove.cell' }, ...capabilities)
  }

  private reduce = (strands: IStrand[]): Seed[] => {
    const map = new Map<Seed, boolean>()

    for (const strand of strands) {
      if (strand.op === 'add.cell') map.set(strand.seed, true)
      if (strand.op === 'remove.cell') map.set(strand.seed, false)
    }

    return [...map.entries()].filter(([, visible]) => visible).map(([seed]) => seed)
  }
}
