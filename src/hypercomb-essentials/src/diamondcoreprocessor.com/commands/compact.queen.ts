// diamondcoreprocessor.com/commands/compact.queen.ts
//
// /compact — manual fallback for "rebase to one marker for current state".
//
// With auto-normalization in listLayers, this command is rarely needed —
// every read path now self-corrects bag shape. /compact remains as the
// explicit "wipe and rebase" trigger for cases where the user wants a
// clean slate, or when normalization can't recover (e.g., orphaned
// markers pointing at sigs the pool no longer has).
//
// Rules (per the slim/no-meta model):
//   - No synthetic empty seed prepended
//   - Always commit one marker reflecting current name; cascade
//     rebuilds the children array from disk on the next user event
//   - History before the rebase IS lost; that's the explicit bargain
//     of /compact (vs. the non-destructive normalize on every read)

import { QueenBee } from '@hypercomb/core'
import type { HistoryService, LayerContent } from '../history/history.service.js'
import type { HistoryCursorService } from '../history/history-cursor.service.js'

type Lineage = {
  // explorerDir is async in the live lineage implementation — it
  // resolves to the FileSystemDirectoryHandle for the current
  // explorer location (or null if not available).
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null> | FileSystemDirectoryHandle | null | undefined
  explorerLabel?: () => string
}

export class CompactQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'compact'
  override readonly aliases = []
  override description = 'Rebase this location\'s history to a single live marker (history is lost)'

  protected async execute(_args: string): Promise<void> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
    const lineage = get('@hypercomb.social/Lineage') as Lineage | undefined
    if (!history || !cursor || !lineage) return

    const locationSig = cursor.state.locationSig
    if (!locationSig) return

    // 1. Snapshot current on-disk state.
    const fresh = await this.#assembleFromDisk(lineage)

    // 2. Purge any pre-merkle / op-JSON / sig-named pollution. This
    //    is the only path that destroys history files and ONLY runs
    //    when the user explicitly invokes /compact.
    await history.purgeNonLayerFiles(locationSig)

    // 3. Wipe existing markers. Pool content is untouched (may still
    //    be referenced by other lineages or branches).
    const entries = await history.listLayers(locationSig)
    if (entries.length > 0) {
      await history.removeEntries(locationSig, entries.map(e => e.filename))
    }

    // 3. Mint exactly one marker for the current state. The fresh
    //    snapshot's `children` is always empty — the next user event
    //    cascades and rebuilds child sigs from disk.
    await history.commitLayer(locationSig, fresh)

    // 4. Re-hydrate cursor; land on the top (single marker).
    await cursor.load(locationSig)
    cursor.seek(cursor.state.total)
  }

  /**
   * Build the layer name from the explorer label. /compact wipes
   * history, so we don't try to wire children sigs — leave the array
   * empty. The next user event will cascade up and rebuild the merkle
   * composition by re-reading on-disk children.
   */
  async #assembleFromDisk(lineage: Lineage): Promise<LayerContent> {
    const name = (() => {
      const label = String(lineage.explorerLabel?.() ?? '/')
      if (label === '/' || label === '') return ''
      const parts = label.split('/').filter(Boolean)
      return parts[parts.length - 1] ?? ''
    })()
    return { name, children: [] }
  }
}

const _compact = new CompactQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CompactQueenBee', _compact)
