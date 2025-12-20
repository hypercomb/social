// src/app/core/intent/intent.scanner.ts

import { Injectable, inject } from '@angular/core'
import { DebugService } from '../../common/debug/debug.service'
import { CapabilityDoc } from '../capability/capability-doc.model'
import { Capability } from '../capability/capability.interface'
import { RESOURCE_RESOLVERS } from '../hive/i-resource-resolver.token'
import { LayerManager } from '../hive/layer.manager'
import { NucleotideManager } from '../hive/nucleotide.manager'
import { CoreIntentPlane } from './models/intent-field-plane.model'
import { SelectionContext } from '../selection/selection-context.model'

export interface ScannedCapability {
  seed: string
  capabilityId: string
  doc: CapabilityDoc
}

export interface IntentScanResult {
  lineage: string
  dominantPlane?: CoreIntentPlane
  capabilities: ScannedCapability[]
  selection?: SelectionContext
}



@Injectable({ providedIn: 'root' })
export class IntentScanner {
  private readonly layermgr = inject(LayerManager)
  private readonly nucleotides = inject(NucleotideManager)
  private readonly debug = inject(DebugService)
  private readonly capabilities = inject<ReadonlyArray<Capability>>(RESOURCE_RESOLVERS as any)

  public scan = async (lineage: string): Promise<IntentScanResult> => {
    // scan visible seeds only
    const seeds = await this.layermgr.cells(lineage)

    const results: ScannedCapability[] = []

    for (const seed of seeds) {
      const activeCaps = await this.nucleotides.capabilities(lineage, seed)

      for (const capId of activeCaps) {
        const cap = this.resolveCapability(capId)
        if (!cap) continue

        results.push({
          seed,
          capabilityId: cap.capabilityId,
          doc: cap.describe()
        })
      }
    }

    this.debug.log('intent-scan', lineage, results)

    return { lineage, capabilities: results }
  }

  private resolveCapability = (capabilityId: string): Capability | null => {
    for (const cap of this.capabilities) {
      if (cap.capabilityId === capabilityId) return cap
    }
    return null
  }
}
