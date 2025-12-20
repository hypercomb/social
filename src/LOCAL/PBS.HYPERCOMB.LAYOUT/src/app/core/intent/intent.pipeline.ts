import { Injectable, inject } from '@angular/core'
import { selectIntentFieldContext } from '../diamond-core/intent-field.selector'
import { HypercombState } from '../hypercomb-state'
import { IntentFieldSnapshot } from './models/intent-field.model'
import { DiamondCoreProcessor } from '../diamond-core/diamond-core.processor'
import { CapabilityScanner } from '../capabilities/capability-scanner'
import { CommitDraft } from '../diamond-core/commit-draft.model'
import { IntentFieldBuilder } from './intent-field.builder'
import { FindContentProbe } from '../observe/find-content/find-content.probe'

@Injectable({ providedIn: 'root' })
export class IntentPipeline {

  private readonly builder = inject(IntentFieldBuilder)
  private readonly findContent = inject(FindContentProbe)

  private readonly state = inject(HypercombState)
  private readonly core = inject(DiamondCoreProcessor)
  private readonly capabilityScanner = inject(CapabilityScanner)

  public ingestText = async (text: string): Promise<void> => {
    // observation intents never enter the commit pipeline
    const handled = await this.findContent.tryRun(text)
    if (handled) return

    const snapshot = this.builder.fromText(text)
    this.ingest(snapshot)
  }

  public ingest = (snapshot: IntentFieldSnapshot): void => {
    const intent = selectIntentFieldContext(snapshot)
    if (!intent.dominantIntent) return

    const selection = this.state.selection() ?? undefined

    const draft: CommitDraft = {
      lineage: this.state.lineage(),
      intent,
      selection
    }

    this.capabilityScanner.missing(draft)
    this.core.commit(draft)
  }
}
