// diamondcoreprocessor.com/history/collapse-history.queen.ts
//
// /collapse-history — dev utility that walks every location bag under
// __history__/ and deletes all layer entries except the highest-numbered
// one (the current head). Also clears persisted cursor positions so
// every bag snaps to head on the next load. Useful for wiping
// accumulated noise (empty-state commits, duplicates) without losing
// the current state.

import { QueenBee } from '@hypercomb/core'

type HistoryStore = {
  history: FileSystemDirectoryHandle
}

export class CollapseHistoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'history'
  readonly command = 'collapse-history'
  override readonly aliases = ['collapse-histories', 'squash-history']

  override description = 'Delete all non-head history entries across every location (dev utility)'

  protected execute(_args: string): void {
    void this.#collapse()
  }

  async #collapse(): Promise<void> {
    const store = get<HistoryStore>('@hypercomb.social/Store')
    if (!store?.history) {
      console.warn('[/collapse-history] Store not available')
      return
    }

    let bags = 0
    let removed = 0

    for await (const [, bag] of store.history.entries()) {
      if (bag.kind !== 'directory') continue
      bags++
      try {
        const layers = await (bag as FileSystemDirectoryHandle).getDirectoryHandle('layers', { create: false })
        const names: string[] = []
        for await (const [name, handle] of layers.entries()) {
          if (handle.kind === 'file' && name.endsWith('.json')) names.push(name)
        }
        if (names.length <= 1) continue
        names.sort()
        const head = names[names.length - 1]
        for (const name of names) {
          if (name === head) continue
          await layers.removeEntry(name)
          removed++
        }
      } catch {
        // no layers/ dir in this bag — nothing to collapse
      }
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
