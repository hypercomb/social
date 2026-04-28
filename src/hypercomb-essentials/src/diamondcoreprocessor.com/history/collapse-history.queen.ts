// diamondcoreprocessor.com/history/collapse-history.queen.ts
//
// /collapse-history — dev utility that walks every lineage bag under
// __history__/ and keeps only the chronologically newest layer entry,
// soft-deleting the rest into __temporary__/. Also clears persisted
// cursor positions so every bag snaps to head on the next load.
//
// Operates on the current bag-root layout: layer files live directly
// at __history__/{lineageSig}/{sig}, ordered by file.lastModified.
// No inner `layers/` subdir — that path was removed in the bag-root
// refactor; the migrator in HistoryService cleans up legacy bags
// lazily on first listLayers call.

import { QueenBee } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'

type HistoryStore = {
  history: FileSystemDirectoryHandle
}

export class CollapseHistoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'history'
  readonly command = 'collapse-history'
  override readonly aliases = ['collapse-histories', 'squash-history']

  override description = 'Delete all non-head history entries across every location (dev utility)'
  // Destructive dev utility — keep it out of autocomplete so it can't
  // be triggered by an accidental tab-complete on `/co…`. Still
  // invokable when typed in full.
  override slashHidden = true

  protected execute(_args: string): void {
    void this.#collapse()
  }

  async #collapse(): Promise<void> {
    const store = get<HistoryStore>('@hypercomb.social/Store')
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!store?.history || !history) {
      console.warn('[/collapse-history] Store or HistoryService not available')
      return
    }

    let bags = 0
    let removed = 0

    for await (const [lineageSig, bag] of store.history.entries()) {
      if (bag.kind !== 'directory') continue
      bags++
      // listLayers handles the legacy-`layers/` migrator and the
      // bag-pollution cleanup before returning, so by the time we
      // see the rows the bag is well-formed.
      const entries = await history.listLayers(lineageSig)
      if (entries.length <= 1) continue
      const keep = entries[entries.length - 1]   // newest by mtime
      const toDelete = entries
        .filter(e => e.filename !== keep.filename)
        .map(e => e.filename)
      removed += await history.archiveEntries(lineageSig, toDelete)
    }

    // Clear persisted cursor positions so each bag snaps to head next load
    let cleared = 0
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith('hc:cursor-position:')) {
        localStorage.removeItem(key)
        cleared++
      }
    }

    console.log(
      `[/collapse-history] ${bags} bag(s); removed ${removed} non-head layer entries; cleared ${cleared} cursor positions. Reloading…`,
    )
    // Give the console message a tick to flush before the reload.
    setTimeout(() => location.reload(), 50)
  }
}

const _collapseHistory = new CollapseHistoryQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CollapseHistoryQueenBee', _collapseHistory)
