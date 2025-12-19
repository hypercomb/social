// src/app/core/hive/hive.manager.ts

import { inject } from '@angular/core'
import { Hypercomb } from '../hypercomb.base'
import { IHiveManager, Seed } from './i-dna.token'
import { LayerManager } from './layer.manager'

export class HiveManager extends Hypercomb implements IHiveManager {
  private readonly layermgr = inject(LayerManager)
  private readonly rootLineage = 'hypercomb'

  public hives = async (): Promise<Seed[]> => {
    return await this.layermgr.cells(this.rootLineage)
  }

  public add = async (seed: Seed): Promise<void> => {
    await this.layermgr.add(this.rootLineage, seed)
  }

  public remove = async (seed: Seed): Promise<void> => {
    await this.layermgr.remove(this.rootLineage, seed)
  }

  public exists = async (seed: Seed): Promise<boolean> => {
    return (await this.hives()).includes(seed)
  }

  public find = async (seed: Seed): Promise<Seed | null> => {
    return (await this.exists(seed)) ? seed : null
  }
}
