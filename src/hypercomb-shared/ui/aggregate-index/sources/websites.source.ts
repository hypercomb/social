// hypercomb-shared/ui/aggregate-index/sources/websites.source.ts
//
// Websites as an aggregate index source — replacing `website-landing/`, which
// was a second, near-identical copy of the collections landing (same location
// gate, same card grid, same image resolution) that could not gain a capability
// without the other being rewritten to match. Now it declares data and intent;
// the shared panel draws it and hands it drag-to-create-meaning for free.
//
// Nothing about the DATA model changes. Membership is still the AGGREGATION
// LAYER (core/aggregation-layer.ts + documentation/aggregation-layer-model.md):
// the ['websites'] page layer's children ARE the menu, read THROUGH THE CURSOR
// so undo-browsing this location shows the rewound menu rather than the head.
// Opening still routes through `WebsitesGroup.open` so the navigate + website
// mode flip is unchanged, and removal is still an ordinary `disableAggregation`
// commit.
//
// Shell-level: resolves services through window.ioc at call time; never imports
// essentials.

import { disableAggregation, listAggregationAtCursor } from '../../../core/aggregation-layer'
import { groupRegistry } from '../../../core/group-registry'
import { registerAggregateSource, type AggregateItem, type AggregateSource } from '../aggregate-source'

/** The websites group's page is its OWN root location, /websites — the group id
 *  IS the segment (see mixed-group-bag.ts). */
const WEBSITES = 'websites'
/** Decoration kind carrying a generated site page (payload.htmlSig). */
const PAGE_KIND = 'visual:website:page'
const SIG = /^[0-9a-f]{64}$/

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

class WebsitesSource implements AggregateSource {
  readonly id = 'websites'
  readonly icon = 'language'
  readonly titleKey = 'website-landing.title'
  readonly activeAt = [WEBSITES] as const
  readonly changed = groupRegistry

  readonly #images = new Map<string, string>()
  #imageRequested = new Set<string>()

  async items(): Promise<readonly AggregateItem[]> {
    const members = (await listAggregationAtCursor(WEBSITES))
      .map(m => ({
        key: JSON.stringify(m.segments),
        label: m.label || m.segments[m.segments.length - 1],
        segments: m.segments,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    for (const m of members) {
      if (this.#imageRequested.has(m.key)) continue
      this.#imageRequested.add(m.key)
      void this.#resolveImage(m.key, m.segments)
    }

    return members.map(m => ({ ...m, image: this.#images.get(m.key) }))
  }

  /** Open EXACTLY as a launcher tile did — the group owns the navigate + website
   *  mode flip, so routing stays in one place. */
  open(item: AggregateItem): void {
    groupRegistry.get(WEBSITES)?.open({
      key: item.key,
      label: item.label,
      segments: [...item.segments],
    })
  }

  /** Remove from the MENU — an ordinary aggregation commit, undoable at
   *  /websites like any other change there. The site's content is untouched. */
  async remove(item: AggregateItem): Promise<void> {
    await disableAggregation(WEBSITES, [...item.segments])
  }

  async #resolveImage(key: string, segments: readonly string[]): Promise<void> {
    const h = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const s = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!h?.sign || !s?.getResource) { this.#imageRequested.delete(key); return }
    try {
      const loc = await h.sign({ explorerSegments: () => segments })
      const layer = await h.currentLayerAt(loc)
      const props = layer?.['properties']
      const first = Array.isArray(props) ? props[0] as Record<string, unknown> | undefined : undefined
      const small = first?.['small'] as Record<string, unknown> | undefined
      const img = small?.['image']
      if (typeof img !== 'string' || !SIG.test(img)) return
      const blob = await s.getResource(img)
      if (!blob) return
      const prev = this.#images.get(key)
      if (prev) URL.revokeObjectURL(prev)
      this.#images.set(key, URL.createObjectURL(blob))
    } catch { /* a missing picture just falls back to the monogram */ }
  }
}

registerAggregateSource(new WebsitesSource())
