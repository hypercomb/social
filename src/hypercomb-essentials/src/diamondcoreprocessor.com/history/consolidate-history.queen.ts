// diamondcoreprocessor.com/history/consolidate-history.queen.ts
//
// /consolidate-history — Phase-2 manual relocation + cleanup. Copies any
// lineage sigbag still living in the legacy `__history__/` pool WHOLE into the
// hive root (`__hive__/<lineageSig>/`), then removes the now-empty
// `__history__` folder. Promote-on-write already relocates bags as they're
// committed; this sweeps the read-only stragglers and retires the legacy
// folder for good.
//
// Non-destructive to history itself — bags are RELOCATED, never dropped, and
// the folder removal is gated inside HistoryService.gcLegacyHistory() on every
// bag being confirmed present at the hive root first. A partial/failed copy
// leaves `__history__` in place (safe no-op).

import { QueenBee } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'

export class ConsolidateHistoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'history'
  readonly command = 'consolidate-history'
  override readonly aliases = ['retire-history-folder', 'migrate-history']

  override description = 'Relocate leftover __history__ bags into the hive root and remove the legacy folder'
  override examples = [
    { input: '/consolidate-history', result: 'Relocates legacy __history__ bags to the hive root' },
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
      `[/consolidate-history] ${report.bags} legacy bag(s); ${report.copied} relocated to the hive root; ` +
      `__history__ ${report.removed ? 'removed' : 'retained (not all bags confirmed — safe no-op)'}.`,
    )
  }
}

const _consolidateHistory = new ConsolidateHistoryQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ConsolidateHistoryQueenBee', _consolidateHistory)
