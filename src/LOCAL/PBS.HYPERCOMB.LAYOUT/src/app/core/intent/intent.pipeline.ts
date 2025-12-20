// src/app/core/intent/intent-pipeline.ts

import { Injectable, inject } from '@angular/core'
import { selectIntentFieldContext } from '../diamond-core/intent-field.selector'
import { HypercombState } from '../hypercomb-state'
import { IntentFieldSnapshot } from './models/intent-field.model'
import { DiamondCoreProcessor } from '../diamond-core/diamond-core.processor'
import { CapabilityScanner } from '../capabilities/capability-scanner'
import { CommitDraft } from '../diamond-core/commit-draft.model'

@Injectable({ providedIn: 'root' })
export class IntentPipeline {

  private readonly state = inject(HypercombState)
  private readonly core = inject(DiamondCoreProcessor)
  private readonly capabilityScanner = inject(CapabilityScanner)

  public dispatch(snapshot: IntentFieldSnapshot): void {
    const intent = selectIntentFieldContext(snapshot)
    if (!intent.dominantIntent) return

    const selection = this.state.selection() ?? undefined

    const draft: CommitDraft = {
      lineage: this.state.lineage(),
      intent,
      selection
    }

    // capabilities are scanned here ONLY for UX / diagnostics
    const missing = this.capabilityScanner.missing(draft)
    if (missing.length) return

    this.core.commit(draft)
  }
}
