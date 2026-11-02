// hypercomb-shared/ui/aggregate-index/sources/recents.source.ts
//
// Recents as an aggregate index source — every atom this hive ever made,
// newest first (documentation/recents-and-the-quick-tray.md, codex H7). The
// rows come from the recents census reader (essentials,
// history/recents-census.*); this source only reads it through IoC. A miss
// asks for it and the list fills when `recents:census-changed` lands: a derived
// cache is never load-bearing, and no walk happens here.
//
// Hidden tiles are SHADED, never absent: the reader marks them, reading the
// session's hide list at answer time, and a hide only has to trigger a re-read.
// An atom no page lists has no location for a reference to point at, so its row
// is `loose`: it does not drag, and opening it sends it to the quick tray.
// Portals is a sibling source, not this one: roots you chose to keep.
//
// Shell-level: resolves services through window.ioc at call time; never
// imports essentials.

import { EffectBus } from '@hypercomb/core'
import { registerAggregateSource, type AggregateItem, type AggregateSource } from '../aggregate-source'

type RecentAtom = {
  sig: string; label: string; path: readonly string[]; at: number; placed: boolean; hidden: boolean
}
type CensusLike = { atoms(): Promise<readonly RecentAtom[]> }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

class RecentsSource implements AggregateSource {
  readonly id = 'recents'
  readonly icon = 'history'
  readonly titleKey = 'recents-landing.title'
  readonly ledeKey = 'recents-landing.lede'
  readonly changed = new EventTarget()

  /** The sig each loose row's key stands for — `open` needs it back. */
  readonly #looseSigs = new Map<string, string>()

  constructor() {
    const reread = (): void => { this.changed.dispatchEvent(new CustomEvent('change')) }
    EffectBus.on('recents:census-changed', reread)
    EffectBus.on('tile:hidden', reread)
    EffectBus.on('tile:unhidden', reread)
  }

  async items(): Promise<readonly AggregateItem[]> {
    const reader = ioc()?.get('@diamondcoreprocessor.com/RecentsCensus') as CensusLike | undefined
    const atoms = (await reader?.atoms().catch(() => null)) ?? []
    if (atoms.length === 0) EffectBus.emitTransient('recents:wanted', {})
    this.#looseSigs.clear()
    return atoms.map(atom => {
      const key = atom.sig
      if (!atom.placed) this.#looseSigs.set(key, atom.sig)
      return {
        key,
        label: atom.label || atom.path[atom.path.length - 1] || '',
        segments: atom.path,
        ...(atom.hidden ? { shaded: true } : {}),
        ...(atom.placed ? {} : { loose: true }),
      }
    })
  }

  /** Walk to where the atom stands; an atom no page lists goes to the tray. */
  open(item: AggregateItem): void {
    if (item.loose) {
      EffectBus.emit('quick-tray:take', { label: item.label, segments: [], sig: this.#looseSigs.get(item.key), loose: true })
      return
    }
    (ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined)?.goRaw?.([...item.segments])
  }
}

registerAggregateSource(new RecentsSource())
