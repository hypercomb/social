// diamondcoreprocessor.com/commands/compact.queen.ts
//
// /compact — rebase this location's history to two layers:
//
//   #1 (oldest)  empty seed     {cells: [], hidden: []}
//   #2 (newest)  what's showing  the kept current state
//
// The empty seed is a real layer file (no longer a virtual anchor),
// so undo from the current state always lands on a concrete empty
// position. The kept layer mirrors what the user has on screen at
// the moment of /compact — that IS the slim layer's job.
//
// Direct CRUD: every other layer file in the bag is removed outright.
// No archive, no TTL — DCP push is the backup story.

import { QueenBee } from '@hypercomb/core'
import type { HistoryService, LayerContent } from '../history/history.service.js'
import type { HistoryCursorService } from '../history/history-cursor.service.js'

const EMPTY_LAYER: LayerContent = { cells: [], hidden: [] }

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
  override description = 'Rebase this location\'s history to an empty seed + current state'

  protected async execute(_args: string): Promise<void> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
    const lineage = get('@hypercomb.social/Lineage') as Lineage | undefined
    if (!history || !cursor || !lineage) return

    const locationSig = cursor.state.locationSig
    if (!locationSig) return

    // 1. Delete every existing marker. Sig content files are
    //    untouched (they may still be live elsewhere; orphan-sig GC
    //    is a separate concern).
    const entries = await history.listLayers(locationSig)
    if (entries.length > 0) {
      await history.removeEntries(locationSig, entries.map(e => e.filename))
    }

    // 2. Write empty seed first (mints marker #1), then write the
    //    fresh on-disk state (mints marker #2). commitLayer always
    //    appends a new marker, so the two writes are guaranteed to
    //    produce two distinct entries even if their sigs collide
    //    with existing sig content files.
    const fresh = await this.#assembleFromDisk(lineage)
    await history.commitLayer(locationSig, EMPTY_LAYER)
    await history.commitLayer(locationSig, fresh)

    // 3. Re-hydrate cursor from disk; land on the top (the fresh
    //    layer — this IS what's showing now).
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
