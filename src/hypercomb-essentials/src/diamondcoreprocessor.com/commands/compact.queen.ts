// diamondcoreprocessor.com/commands/compact.queen.ts
//
// /compact — wipe this lineage's history bag and rebase to a single
// marker reflecting the current on-disk state. After running, the
// bag has exactly one marker whose `children` array holds each
// on-disk child's CURRENT marker sig (the merkle composition).
//
// History before the rebase IS lost; that's the explicit bargain.

import { QueenBee } from '@hypercomb/core'
import type { HistoryService, LayerContent } from '../history/history.service.js'
import { ROOT_NAME } from '../history/history.service.js'
import type { HistoryCursorService } from '../history/history-cursor.service.js'

type Lineage = {
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null> | FileSystemDirectoryHandle | null | undefined
  explorerLabel?: () => string
  explorerSegments?: () => readonly string[]
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

    // 1. Snapshot current on-disk state — name + actual child sigs.
    const fresh = await this.#assembleFromDisk(history, lineage)

    // 2. Purge any pre-merkle / op-JSON / sig-named pollution. This
    //    is the only path that destroys history files and ONLY runs
    //    when the user explicitly invokes /compact.
    await history.purgeNonLayerFiles(locationSig)

    // 3. Wipe existing markers.
    const entries = await history.listLayers(locationSig)
    if (entries.length > 0) {
      await history.removeEntries(locationSig, entries.map(e => e.filename))
    }

    // 4. Commit one marker reflecting current state. commitLayer
    //    auto-mints the seed at 00000000, then this commit lands at
    //    00000001 with the actual children array.
    await history.commitLayer(locationSig, fresh)

    // 5. Re-hydrate cursor; land on the top.
    await cursor.load(locationSig)
    cursor.seek(cursor.state.total)
  }

  /**
   * Build a complete layer for the current lineage:
   *   name     = ROOT_NAME for root, else the last explorer segment
   *   children = each on-disk child's CURRENT marker sig (or omitted
   *              when there are no children — seed shape)
   */
  async #assembleFromDisk(history: HistoryService, lineage: Lineage): Promise<LayerContent> {
    const segments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const name = segments.length === 0 ? ROOT_NAME : segments[segments.length - 1]

    const explorerDir = await Promise.resolve(lineage.explorerDir?.() ?? null)
    const onDiskNames: string[] = []
    if (explorerDir) {
      for await (const [n, handle] of (explorerDir as any).entries()) {
        if (handle.kind === 'directory') onDiskNames.push(n)
      }
    }

    if (onDiskNames.length === 0) return { name }

    const children: string[] = []
    for (const childName of onDiskNames) {
      const childSegments = [...segments, childName]
      const childLocSig = await history.sign({
        explorerSegments: () => childSegments,
      } as Lineage)
      const childSig = await history.latestMarkerSigFor(childLocSig, childName)
      children.push(childSig)
    }
    return { name, children }
  }
}

const _compact = new CompactQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CompactQueenBee', _compact)
