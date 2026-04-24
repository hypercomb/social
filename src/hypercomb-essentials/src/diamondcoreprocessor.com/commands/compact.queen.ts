// diamondcoreprocessor.com/commands/compact.queen.ts
//
// /compact — collapse every history entry at the current location
// into a single head entry, soft-deleting all the sources. The newest
// entry's content becomes the new head (consistent with multi-select
// merge), which is what "compact" means here: all past states fall
// into the 30-day soft-delete archive, the visible list shrinks to
// one row representing the current state.
//
// Scope is this location only — unlike /collapse-history which is a
// dev utility that prunes across every location in the bag. Use /compact
// when a location's history has grown noisy from frequent edits and
// you want to keep only "where it ended up".

import { QueenBee } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'
import type { HistoryCursorService } from '../history/history-cursor.service.js'

export class CompactQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'compact'
  override readonly aliases = []
  override description = 'Collapse this location\'s history into one head entry'

  protected async execute(_args: string): Promise<void> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
    if (!history || !cursor) return

    const locationSig = cursor.state.locationSig
    if (!locationSig) return

    const entries = await history.listLayers(locationSig)
    // Nothing to collapse if there are 0 or 1 entries.
    if (entries.length <= 1) return

    // Merge every entry. mergeEntries picks the chronologically newest
    // selected entry as the new head content and soft-deletes the rest,
    // which is the exact semantic compact wants for "reduce this
    // location to a single head row".
    const filenames = entries.map(e => e.filename)
    await history.mergeEntries(locationSig, filenames)

    // Pin the cursor to the new (single) head so the viewer snaps
    // to it instead of leaving the user on a rewound-to-nothing slot.
    const after = await history.listLayers(locationSig)
    cursor.seek(after.length)
  }
}

// ── registration ────────────────────────────────────────

const _compact = new CompactQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CompactQueenBee', _compact)
