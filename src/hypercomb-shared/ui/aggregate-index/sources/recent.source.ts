// hypercomb-shared/ui/aggregate-index/sources/recent.source.ts
//
// RECENT — the hive entrances you have pinned as home, newest first. It
// replaces Portals (the Favorites window) on the rail (jwize 2026-11-26).
//
// Home is the root-level home page: one pinned place, shown AT `/`, never at
// a nested address (recent-portals.store.ts, home-root.ts). Every pin is a
// marker in the home document's pool, so the rows are only that pool's own
// history read back. Nothing is tracked to fill this list. Choosing a row pins
// it again, which lifts it to the top and lands you at the root showing it.
// The pinned place keeps its real lineage behind `/`, so swarm and
// cross-domain indexing and search still see where it lives.
//
// Rows, top to bottom:
//   • HERE, when you stand somewhere that is not already a row: choosing it
//     pins where you are. This is how a place joins Recent.
//   • every place pinned before, newest first, the current home lit.
//   • the hive root: choosing it releases the pin.
// The panel's search field filters them, so an entrance is never lost.
//
// Shell-level: resolves services through window.ioc at call time; never
// imports essentials.

import { EffectBus } from '@hypercomb/core'
import { registerAggregateSource, type AggregateItem, type AggregateSource } from '../aggregate-source'
import type { RecentPortal } from '../../../core/recent-portals.store'

type HomeStoreLike = {
  readonly home?: RecentPortal
  pin(label: string, segments: readonly string[]): void
  unpin(): void
  recent(): Promise<readonly RecentPortal[]>
}
type NavigationLike = { goRaw?: (segments: readonly string[]) => void; segmentsRaw?: () => readonly string[] }
type LineageLike = { explorerSegments?: () => readonly string[] }
type I18nLike = { t?: (key: string, params?: Record<string, unknown>) => string }

const HOME_KEY = '@hypercomb.social/RecentPortalsStore'
const ROOT_KEY = 'recent:root'
const HERE_KEY = 'recent:here'

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const pathKey = (segments: readonly string[]): string => segments.join('/')

const say = (key: string, fallback: string): string => {
  const text = (ioc()?.get('@hypercomb.social/I18n') as I18nLike | undefined)?.t?.(key)
  return text && text !== key ? text : fallback
}

class RecentSource implements AggregateSource {
  readonly id = 'recent'
  readonly icon = 'history'
  readonly titleKey = 'recent.title'
  readonly ledeKey = 'recent.lede'
  readonly changed = new EventTarget()

  constructor() {
    const reread = (): void => { this.changed.dispatchEvent(new CustomEvent('change')) }
    // A pin from anywhere moves the lit row and the order; walking moves the
    // HERE row. The panel coalesces these.
    EffectBus.on('portals:recent-changed', reread)
    window.addEventListener('navigate', reread)
    window.addEventListener('popstate', reread)
  }

  async items(): Promise<readonly AggregateItem[]> {
    const store = ioc()?.get(HOME_KEY) as HomeStoreLike | undefined
    const pinned = (await store?.recent().catch(() => [])) ?? []
    const home = store?.home
    const homeKey = home ? pathKey(home.segments) : ''
    const rows: AggregateItem[] = []

    // Where you stand, read from the lineage rather than the address: at `/`
    // with a home pinned, the address is empty but you are standing in home.
    const here = [...((ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined)?.explorerSegments?.() ?? [])]
    if (here.length > 0 && !pinned.some(p => pathKey(p.segments) === pathKey(here))) {
      rows.push({ key: HERE_KEY, label: here[here.length - 1], segments: here, noteKey: 'recent.here' })
    }

    for (const p of pinned) {
      const key = pathKey(p.segments)
      rows.push({
        key,
        label: p.label || p.segments[p.segments.length - 1],
        segments: p.segments,
        ...(key === homeKey ? { current: true } : {}),
        // Two pins with one name are told apart by where they lead.
        ...(p.segments.length > 1 ? { noteText: '/' + key } : {}),
      })
    }

    rows.push({
      key: ROOT_KEY,
      label: say('recent.root', 'Hive root'),
      segments: [],
      ...(home ? {} : { current: true }),
    })
    return rows
  }

  /** Pin the row as home and stand at the root, which now shows it. */
  open(item: AggregateItem): void {
    const store = ioc()?.get(HOME_KEY) as HomeStoreLike | undefined
    if (!store) return
    if (item.key === ROOT_KEY || item.segments.length === 0) store.unpin()
    else store.pin(item.label, item.segments)

    const navigation = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    // Already at `/`: no new history entry for the same address, only ask
    // the lineage to read the root again, which now resolves to the new home.
    if ((navigation?.segmentsRaw?.() ?? []).length === 0) window.dispatchEvent(new Event('navigate'))
    else navigation?.goRaw?.([])
  }
}

registerAggregateSource(new RecentSource())
