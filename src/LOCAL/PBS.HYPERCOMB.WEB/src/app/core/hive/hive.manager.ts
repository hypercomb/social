// src/app/core/hive/hive.manager.ts
import { inject } from '@angular/core'
import { Hypercomb } from '../mixins/abstraction/hypercomb.base'
import { IHiveManager, Seed } from './i-dna.token'
import { LayerManager } from './layer.manager'

export class HiveManager extends Hypercomb implements IHiveManager {
  private readonly layermgr = inject(LayerManager)
  private readonly hypercomb = 'hypercomb'
  // hives are just cells visible at root lineage
  public hives = async (): Promise<Seed[]> => {
    return await this.layermgr.cells(this.hypercomb)
  }

  // add hive = add strand at root
  public add = async (seed: Seed): Promise<void> => {
    await this.layermgr.add(this.hypercomb, seed, 'add-cell')
  }

  // remove hive = remove strand at root
  public remove = async (seed: Seed): Promise<void> => {
    await this.layermgr.add(this.hypercomb, seed, 'remove-cell')
  }

  public exists = async (seed: Seed): Promise<boolean> => {
    const hives = await this.hives()
    return hives.includes(seed)
  }

  public find = async (seed: Seed): Promise<Seed | null> => {
    return (await this.exists(seed)) ? seed : null
  }
}
