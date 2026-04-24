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

import { QueenBee, hypercomb } from '@hypercomb/core'
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
    if (entries.length <= 1) return

    // Compact-to-cursor semantic: the entry CURRENTLY AT THE CURSOR
    // becomes the surviving state. Everything else — older AND
    // newer — gets soft-deleted. Previously this used mergeEntries
    // which always picked the chronologically newest, ignoring the
    // user's cursor position, so collapsing while rewound would
    // resurrect whatever happened to be newest on disk instead of
    // the past state the user intentionally scrolled to.
    //
    // Result on disk: one real entry (the promoted target) at the
    // head of the bag. Position 0 is the synthetic empty seed
    // (render-only, no file — the reducer identity). User sees:
    //   0000 — emptyish
    //   0001 — the state I collapsed to
    //
    // Lossy by design: the discarded entries land in __deleted__/
    // and stay restorable for 30 days; the content-addressed
    // layers they referenced remain in __layers__/.
    const pos = cursor.state.position
    const targetIndex = Math.max(0, Math.min(pos - 1, entries.length - 1))
    const target = entries[targetIndex]
    if (!target) return

    // Promote the target's layer to a fresh head entry (same sig —
    // content-addressed, so no re-write of the layer itself, just a
    // new marker pointing at it).
    // Resolve the target layer's content so we can apply it to OPFS
    // below. Without this step /compact would produce two entries
    // whenever the cursor is rewound: one for the target layer, and
    // a second one that LayerCommitter emits right after cursor.seek
    // captures the live OPFS state (which still holds cells the user
    // added AFTER the rewound position).
    const store = get('@hypercomb.social/Store') as {
      getResource: (sig: string) => Promise<Blob | null>
      hypercombRoot: FileSystemDirectoryHandle
    } | undefined
    if (!store) return
    let targetContent: { cells?: string[] } | null = null
    try {
      const blob = await store.getResource(target.layerSig)
      if (blob) targetContent = JSON.parse(await blob.text())
    } catch { /* no content — leave live OPFS alone, commit may still dedup */ }

    const promotedSig = await history.promoteToHead(locationSig, target.layerSig)
    if (!promotedSig) return

    // Soft-delete everything except the entry we just wrote. Re-list
    // AFTER promoting so the new head is present in the list and we
    // can exclude its filename correctly.
    const afterPromote = await history.listLayers(locationSig)
    const newHead = afterPromote[afterPromote.length - 1]
    if (!newHead) return
    const toDelete = afterPromote
      .filter(e => e.filename !== newHead.filename)
      .map(e => e.filename)
    if (toDelete.length > 0) {
      await history.removeEntries(locationSig, toDelete)
    }

    // "Git checkout" the target state into OPFS: delete any cell dir
    // at this location that ISN'T in the target layer's cells array.
    // Forward cells (added after the rewound position) disappear so
    // the live state matches the collapsed head; LayerCommitter's
    // next commit then dedupes against the head we just wrote and
    // we end up with exactly one entry, not two.
    //
    // Cells that were in the target but aren't on disk today (a
    // rare edge case — target references a cell the user later
    // deleted from OPFS directly) are left absent. Restoring them
    // would require re-materialising content resources, which is a
    // separate operation.
    if (targetContent?.cells) {
      const lineage = get('@hypercomb.social/Lineage') as {
        explorerDir: () => Promise<FileSystemDirectoryHandle | null>
      } | undefined
      const dir = await lineage?.explorerDir?.()
      if (dir) {
        const keep = new Set(targetContent.cells)
        const toRemove: string[] = []
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind !== 'directory') continue
          if (name.startsWith('__')) continue
          if (!keep.has(name)) toRemove.push(name)
        }
        for (const name of toRemove) {
          try { await dir.removeEntry(name, { recursive: true }) } catch { /* best-effort */ }
        }
      }
    }

    // Pin the cursor to the surviving head so the canvas snaps to
    // the collapsed state instead of leaving the user on a now-
    // invalid rewound position.
    const final = await history.listLayers(locationSig)
    cursor.seek(final.length)

    // Nudge the processor so the render path catches up to the
    // trimmed OPFS state; LayerCommitter's next commit (if any)
    // will then dedup against the head we just wrote.
    void new hypercomb().act()
  }
}

// ── registration ────────────────────────────────────────

const _compact = new CompactQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CompactQueenBee', _compact)
