// hypercomb-shared/ui/aggregate-index/sources/recents.source.ts
//
// Recents as an aggregate index source — every atom this hive ever made,
// newest first (documentation/recents-and-the-quick-tray.md, codex H7). The
// rows come from the recents census, a DERIVED record the optimize phase
// mints keyed by the root layer sig (essentials, history/recents-census.*);
// this source only reads it through IoC. Absent means "not yet": the list is
// empty and nothing is walked — a derived cache is never load-bearing.
//
// Hidden tiles are SHADED, never absent. A hide is session-only state (the
// session hide store), not a fact in any layer, so the census cannot carry it
// and the litmus says it must not: this source follows the hive's own
// `tile:hidden` / `tile:unhidden` announcements and marks the matching rows.
// Portals is a sibling source, not this one: roots you chose to keep.
//
// Shell-level: resolves services through window.ioc at call time; never
// imports essentials.

import { EffectBus } from '@hypercomb/core'
import { registerAggregateSource, type AggregateItem, type AggregateSource } from '../aggregate-source'

type CensusEntry = { sig: string; label: string; path: readonly string[]; at: number }
type CensusLike = { census(): Promise<{ entries: readonly CensusEntry[] } | null> }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

/** Joins a path into a comparable key — NUL is the one character a tile name
 *  can never carry (an escape, never a literal control byte). */
const pathKey = (segments: readonly string[]): string => segments.join('\u0000')

class RecentsSource implements AggregateSource {
  readonly id = 'recents'
  readonly icon = 'history'
  readonly titleKey = 'recents-landing.title'
  readonly ledeKey = 'recents-landing.lede'
  readonly changed = new EventTarget()

  /** Paths hidden this session, as the hive announced them. */
  readonly #hidden = new Set<string>()

  constructor() {
    EffectBus.on('recents:census-changed', () => this.changed.dispatchEvent(new CustomEvent('change')))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:hidden', p => this.#mark(p, true))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:unhidden', p => this.#mark(p, false))
  }

  #mark(p: { cell?: string; segments?: string[] } | undefined, hidden: boolean): void {
    if (!p?.cell) return
    const key = pathKey([...(p.segments ?? []), p.cell])
    const was = this.#hidden.has(key)
    if (hidden) this.#hidden.add(key); else this.#hidden.delete(key)
    if (was !== hidden) this.changed.dispatchEvent(new CustomEvent('change'))
  }

  async items(): Promise<readonly AggregateItem[]> {
    const reader = ioc()?.get('@diamondcoreprocessor.com/RecentsCensus') as CensusLike | undefined
    const record = await reader?.census().catch(() => null)
    const entries = [...(record?.entries ?? [])]
      // The root itself is where you stand, not an atom you made.
      .filter(e => e.path.length > 0)
      .sort((a, b) => (b.at - a.at) || (a.path.length - b.path.length) || a.label.localeCompare(b.label))
    return entries.map(e => ({
      key: e.sig + '|' + pathKey(e.path),
      label: e.label || e.path[e.path.length - 1]!,
      segments: e.path,
      ...(this.#hidden.has(pathKey(e.path)) ? { shaded: true } : {}),
    }))
  }

  /** Open a row: walk to where the atom stands. */
  open(item: AggregateItem): void {
    (ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined)?.goRaw?.([...item.segments])
  }
}

registerAggregateSource(new RecentsSource())
