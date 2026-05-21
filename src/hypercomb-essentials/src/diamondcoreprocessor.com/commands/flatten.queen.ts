// diamondcoreprocessor.com/commands/flatten.queen.ts
//
// /flatten — collapse this location's history to two markers: the
// empty start (00000000) and the head's content (00000001), byte-
// identical to what was just at the tip. Everything in between is
// thrown away. Nothing is reassembled from disk — the head layer's
// children and slots survive verbatim.
//
// Previously named /compact. Renamed because the operation isn't a
// "compact" (which suggests squeeze-while-preserving) — it discards
// the middle and keeps only the two endpoints, flattening the chain
// down to start + head.
//
// History before the flatten IS lost; that's the explicit bargain.

import { QueenBee } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'
import type { HistoryCursorService } from '../history/history-cursor.service.js'

export class FlattenQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'flatten'
  override readonly aliases = []
  override description = 'Collapse this location\'s history to its head (history is lost)'
  // Destructive — keep it out of autocomplete so the user has to type
  // the full name. They can still invoke it; tab-complete just won't
  // surface it.
  override slashHidden = true

  protected async execute(_args: string): Promise<void> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
    if (!history || !cursor) return

    const locationSig = cursor.state.locationSig
    if (!locationSig) return

    // 1. Read the current head's content verbatim. This is what we
    //    keep. If there's no head (empty bag), there's nothing to
    //    flatten.
    const entries = await history.listLayers(locationSig)
    if (entries.length === 0) return
    const head = entries[entries.length - 1]
    const headContent = await history.getLayerContent(locationSig, head.layerSig)
    if (!headContent) return

    // 2. Purge any pre-merkle / op-JSON / sig-named pollution. This
    //    is the only path that destroys history files and ONLY runs
    //    when the user explicitly invokes /flatten.
    await history.purgeNonLayerFiles(locationSig)

    // 3. Archive existing markers into __temporary__/ inside the bag.
    //    Soft-delete, not hard — the bag mirrors deleted history so
    //    /flatten can be undone manually if needed. The empty marker
    //    re-mint and fresh commit below land on names that don't
    //    collide because #nextMarkerName scans the archive too.
    await history.archiveEntries(locationSig, entries.map(e => e.filename))

    // 4. Commit one marker carrying the head's content verbatim.
    //    commitLayer auto-mints the empty layer at 00000000, then
    //    this commit lands at 00000001 with the exact bytes (and
    //    thus the same sig) as the prior head — children, notes,
    //    tags and any other slots survive unchanged.
    await history.commitLayer(locationSig, headContent)

    // 5. Re-hydrate cursor; land on the top.
    await cursor.load(locationSig)
    cursor.seek(cursor.state.total)
  }
}

const _flatten = new FlattenQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/FlattenQueenBee', _flatten)
