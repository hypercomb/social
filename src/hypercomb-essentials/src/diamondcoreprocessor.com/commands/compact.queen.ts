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
//   - One marker if disk has cells, zero markers if not
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

    // 2. Wipe existing markers. Pool content is untouched (may still
    //    be referenced by other lineages or branches).
    const entries = await history.listLayers(locationSig)
    if (entries.length > 0) {
      await history.removeEntries(locationSig, entries.map(e => e.filename))
    }

    // 3. Mint exactly one marker for the current state — only if
    //    there's actually something on disk. No synthetic empty seed.
    if (fresh.cells.length > 0 || fresh.hidden.length > 0) {
      await history.commitLayer(locationSig, fresh)
    }

    // 4. Re-hydrate cursor; land on the top (single marker, or
    //    nothing if disk was empty).
    await cursor.load(locationSig)
    cursor.seek(cursor.state.total)
  }

  /**
   * Read cells from the OPFS directory listing — same source the
   * renderer at head walks. Hidden comes from localStorage
   * (`hc:hidden-tiles:{loc}`). explorerDir() is async in the live
   * lineage; await it before iterating.
   */
  async #assembleFromDisk(lineage: Lineage): Promise<LayerContent> {
    const explorerDir = await lineage.explorerDir?.()
    const cells: string[] = []
    if (explorerDir) {
      for await (const [name, handle] of (explorerDir as any).entries()) {
        if (handle.kind === 'directory') cells.push(name)
      }
    }

    const locationKey = String(lineage.explorerLabel?.() ?? '/')
    let hidden: string[] = []
    try {
      const raw = localStorage.getItem(`hc:hidden-tiles:${locationKey}`)
      const parsed = raw ? JSON.parse(raw) : []
      hidden = Array.isArray(parsed) ? parsed.map(String) : []
    } catch { /* default to none */ }

    return { cells, hidden }
  }
}

const _compact = new CompactQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CompactQueenBee', _compact)
