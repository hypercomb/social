// src/app/core/intent/semantic-resolver.ts

import { Injectable } from '@angular/core'
import { Intent } from './models/intent.model'
import { IntentScanResult } from './intent.scanner'

export interface SemanticResolution {
  executable: boolean
  op?: 'add.cell' | 'remove.cell'
  object?: string
  confidence: number
}

@Injectable({ providedIn: 'root' })
export class SemanticResolver {

  /**
   * collapse intent fragments inward toward a stable executable center
   */
  public resolve(
    intent: Intent,
    scan: IntentScanResult
  ): SemanticResolution | null {

    const selection = scan.selection

    // explicit add
    if (intent.key === 'add.cell') {
      return {
        executable: true,
        op: 'add.cell',
        object: selection?.primarySeed ?? intent.noun,
        confidence: 1
      }
    }

    // explicit remove
    if (intent.key === 'remove.cell') {
      if (!selection?.primarySeed) {
        return {
          executable: false,
          confidence: 0.2
        }
      }

      return {
        executable: true,
        op: 'remove.cell',
        object: selection.primarySeed,
        confidence: 1
      }
    }

    // implicit object gravity
    if (intent.key === 'object.tile') {
      const hasCreate = scan.capabilities.some(
        c => c.capabilityId === 'add.cell'
      )

      if (hasCreate) {
        return {
          executable: true,
          op: 'add.cell',
          object: selection?.primarySeed ?? 'tile',
          confidence: selection ? 0.9 : 0.7
        }
      }

      return {
        executable: false,
        confidence: 0.4
      }
    }

    return null
  }
}
