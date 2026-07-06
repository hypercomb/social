// diamondcoreprocessor.com/history/consolidate-history.queen.ts
//
// /consolidate-history — manual force-run of the history self-clean. Copies
// any lineage sigbag still living in a legacy drain source (`__history__/`)
// WHOLE into its bag at the OPFS root (`<lineageSig>/`), then removes the
// now-empty legacy folder. The self-cleaning drain (HistoryService's detached,
// delayed pass) and promote-on-write already relocate bags as they're touched;
// this sweeps the read-only stragglers and retires the legacy folder for good.
//
// Non-destructive to history itself — bags are RELOCATED, never dropped, and
// the folder removal is gated inside HistoryService.gcLegacyHistory() on every
// legacy entry being confirmed present at the root bag first (per FILE, not
// per directory). A partial/failed copy leaves `__history__` in place (safe
// no-op).

import { QueenBee } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'

export class ConsolidateHistoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'history'
  readonly command = 'consolidate-history'
  override readonly aliases = ['retire-history-folder', 'migrate-history']

  override description = 'Relocate leftover legacy history bags to the root and remove the drained folder'
  override examples = [
    { input: '/consolidate-history', result: 'Relocates legacy history bags to the root; retires the drained folder' },
  ]
  // Maintenance utility — keep it out of autocomplete so a stray tab-complete
  // can't trigger it; still invokable when typed in full.
  override slashHidden = true

  protected execute(_args: string): void {
    void this.#consolidate()
  }

  async #consolidate(): Promise<void> {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) {
      console.warn('[/consolidate-history] HistoryService not available')
      return
    }
    const report = await history.gcLegacyHistory()
    console.log(
      `[/consolidate-history] ${report.bags} legacy bag(s); ${report.copied} relocated to the root; ` +
      `legacy __history__ folder ${report.removed ? 'removed' : 'retained (not all bags confirmed — safe no-op)'}.`,
    )
  }
}

const _consolidateHistory = new ConsolidateHistoryQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ConsolidateHistoryQueenBee', _consolidateHistory)
