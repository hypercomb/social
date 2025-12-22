// src/app/core/hive/nucleotide.manager.ts

import { inject, Injectable } from '@angular/core'
import { IStrand, Seed } from './i-dna.token'
import { OpfsManager } from './opfs.manager'
import { StrandManager } from './strand.writer'

@Injectable({ providedIn: 'root' })
export class NucleotideManager {
  private readonly strandmgr = inject(StrandManager)
  private readonly opfs = inject(OpfsManager)

  // returns active capabilities for a seed at a lineage
  public capabilities = async (lineage: string, seed: Seed): Promise<string[]> => {
    const strands = (await this.strandmgr.list(lineage)).filter(
      s =>
        s.seed === seed &&
        (s.op === 'add.capability' || s.op === 'remove.capability')
    )

    const map = new Map<string, boolean>()

    for (const strand of strands) {
      const caps = await this.readCapabilities(lineage, strand)
      const enabled = strand.op === 'add.capability'

      for (const cap of caps) {
        map.set(cap, enabled)
      }
    }

    return [...map.entries()].filter(([, enabled]) => enabled).map(([cap]) => cap)
  }

  private readCapabilities = async (lineage: string, strand: IStrand): Promise<string[]> => {
    // unchanged logic, hardened parsing below
    const dir = await this.opfs.ensureDirs(lineage.split('/').filter(Boolean))
    const handle = await dir.getFileHandle(this.filename(strand))
    const file = await handle.getFile()
    const text = await file.text()

    return text
      ? text
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .map(line => JSON.parse(line))
      : []
  }

  private filename = (strand: IStrand): string =>
    `${strand.ordinal.toString().padStart(8, '0')}-${strand.seed}-${strand.op}`
}
