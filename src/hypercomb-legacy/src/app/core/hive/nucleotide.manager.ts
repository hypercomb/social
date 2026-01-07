// src/app/core/hive/nucleotide.manager.ts
import { inject, Injectable } from '@angular/core'
import { Seed, IStrand } from './i-dna.token'
import { StrandManager } from './strand-manager'
import { OpfsManager } from 'src/app/common/opfs/opfs-manager'

/*
nucleotide manager
- evaluates intent (capabilities) for a specific seed
- reads strand payloads lazily
- reduces capabilities via toggle semantics
- does not execute capabilities
*/

// create a tile
// next time go down this lineage - loop back this way
// could I please order a pizza (ask this intent)
// what kind of toppings? 
// i want [cheese, pepperoni, pineapple, feta] and also [....] )


@Injectable({ providedIn: 'root' })
export class NucleotideManager {

  private readonly strandmgr = inject(StrandManager)
  private readonly opfs = inject(OpfsManager)

  // returns active capabilities for a seed at a lineage
  public capabilities = async (lineage: string, seed: Seed): Promise<string[]> => {
    const strands = await this.strandmgr.list(lineage)
    const relevant = strands.filter(s => s.seed === seed)

    const active = new Set<string>()

    for (const strand of relevant) {
      const capabilities = await this.readCapabilities(lineage, strand)
      for (const capability of capabilities) {
        if (active.has(capability)) active.delete(capability)
        else active.add(capability)
      }
    }

    return [...active]
  }

  // ---------------------------------------------
  // helpers
  // ---------------------------------------------

  private readCapabilities = async (lineage: string, strand: IStrand): Promise<string[]> => {
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
