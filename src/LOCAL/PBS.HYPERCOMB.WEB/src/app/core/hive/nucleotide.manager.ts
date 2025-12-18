// src/app/core/hive/nucleotide.manager.ts
import { inject, Injectable } from '@angular/core'
import { Seed, IStrand } from './i-dna.token'
import { StrandManager } from './strand-manager'
import { OpfsManager } from 'src/app/common/opfs/opfs-manager'

/*
nucleotide manager
- evaluates intent (actions) for a specific seed
- reads strand payloads lazily
- reduces actions via toggle semantics
- does not execute actions
*/

@Injectable({ providedIn: 'root' })
export class NucleotideManager {

  private readonly strandmgr = inject(StrandManager)
  private readonly opfs = inject(OpfsManager)

  // returns active actions for a seed at a lineage
  public actions = async (lineage: string, seed: Seed): Promise<string[]> => {
    const strands = await this.strandmgr.list(lineage)
    const relevant = strands.filter(s => s.seed === seed)

    const active = new Set<string>()

    for (const strand of relevant) {
      const actions = await this.readActions(lineage, strand)
      for (const action of actions) {
        if (active.has(action)) active.delete(action)
        else active.add(action)
      }
    }

    return [...active]
  }

  // ---------------------------------------------
  // helpers
  // ---------------------------------------------

  private readActions = async (lineage: string, strand: IStrand): Promise<string[]> => {
    const dir = await this.opfs.ensureDirs(lineage.split('/').filter(Boolean))
    const handle = await dir.getFileHandle(this.filename(strand))
    const file = await handle.getFile()
    const text = await file.text()

    return text ? text.split('\n').map(line => JSON.parse(line)) : []
  }

  private filename = (strand: IStrand): string => {
    return `${strand.ordinal.toString().padStart(8, '0')}-${strand.seed}-${strand.op}`
  }
}
