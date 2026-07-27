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
// It also declares VERSIONS, which is what makes this window the place you
// choose which one of a site to be looking at — see the `versions` section
// below for why the local and published chains stay separate.
//
// Shell-level: resolves services through window.ioc at call time; never imports
// essentials.

import { disableAggregation, listAggregationAtCursor } from '../../../core/aggregation-layer'
import { groupRegistry } from '../../../core/group-registry'
import {
  registerAggregateSource,
  type AggregateItem, type AggregateSource, type AggregateVersion,
} from '../aggregate-source'

/** The websites group's page is its OWN root location, /websites — the group id
 *  IS the segment (see mixed-group-bag.ts). */
const WEBSITES = 'websites'
/** Decoration kind carrying a generated site page (payload.htmlSig). */
const PAGE_KIND = 'visual:website:page'
const SIG = /^[0-9a-f]{64}$/
/** The cell's first-class page slot (essentials' `website-slot.ts`). Spelled
 *  here rather than imported — shell code never imports essentials — and the
 *  slot name is protocol, not implementation. */
const WEBSITE_SLOT = 'website'
/** Legacy page slot, still the only page some un-migrated cells have. */
const CONTEXT_SLOT = 'context'

type LayerLike = Record<string, unknown>
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  listLayers(locationSig: string): Promise<ReadonlyArray<{ layerSig: string; at: number }>>
  getLayerBySig(layerSig: string): Promise<LayerLike | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type CommitterLike = { update(segments: readonly string[], layer: object): Promise<string> }

/** The installer's transaction channel, as `initSentinel` parks it. Absent in
 *  the dev shell and whenever DCP is unreachable — every use is optional-chained
 *  so a missing installer costs the local chain nothing. */
type SentinelLike = {
  revisions(domain?: string): Promise<ReadonlyArray<{
    domain: string
    activeRootSig: string
    revisions: ReadonlyArray<{ rootSig: string; label: string; deployedAt?: string }>
  }>>
  useRevision(domain: string, rootSig: string): Promise<boolean>
}

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const sentinel = (): SentinelLike | undefined =>
  (globalThis as { __sentinelBridge?: SentinelLike }).__sentinelBridge

/** Last sig of a slot that holds a flat sig array — the newest entry is the
 *  current one (website-slot.ts). Empty/absent/malformed all read as none. */
const newestSlotSig = (layer: LayerLike | null, slot: string): string | null => {
  const value = layer?.[slot]
  if (!Array.isArray(value)) return null
  const sigs = value.map(s => String(s)).filter(s => SIG.test(s))
  return sigs.length ? sigs[sigs.length - 1] : null
}

/** Fold a name to the same shape a hostname label has, so `Humanity Centres`
 *  and `humanity-centres.example.com` can be recognised as each other. */
const slugify = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

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

  // ── versions ────────────────────────────────────────────────────────────────
  //
  // A site's versions are not a new bookkeeping structure — they are already in
  // the tree. Every commit at the site's location mints a layer, and the page it
  // was showing at that moment is the newest sig in its `website` slot. So the
  // chain of DISTINCT page sigs down the lineage IS the version history, read
  // rather than recorded. (This is the same reasoning that made site iteration
  // go through revisions instead of feature flags: the signature is the handle.)
  //
  // The second chain comes from the INSTALLER, over the sentinel port. It is
  // deliberately not merged with the local one: a deployed package revision is a
  // different kind of "version" than a page this hive once showed, and flattening
  // them into one list would invite choosing across the boundary as if it were a
  // single timeline. DCP stays the only thing that can resolve or apply those —
  // this origin renders a list it cannot forge and posts a pick it cannot verify.

  /** Newest first. Local chain always; published chain only when the installer
   *  is reachable AND recognises a host for this site. */
  async versions(item: AggregateItem): Promise<readonly AggregateVersion[]> {
    const [local, published] = await Promise.all([
      this.#localVersions(item),
      this.#publishedVersions(item),
    ])
    return [...local, ...published]
  }

  /** Put a version in effect.
   *
   *  LOCAL: an ordinary commit of the chosen page sig into the cell's `website`
   *  slot — forward-only, so choosing an older page is itself a new entry in the
   *  history and undoable at the site like any other change. Nothing is rewound
   *  and nothing is deleted; the sig was already resolvable here, which is why
   *  restoring one can never dangle.
   *
   *  PUBLISHED: handed to the installer. This origin does not (and must not) get
   *  to say which package root is active — it asks. */
  async useVersion(item: AggregateItem, version: AggregateVersion): Promise<void> {
    if (!SIG.test(version.sig)) return

    if (version.origin === 'published') {
      const domain = version.domain
      if (!domain) return
      await sentinel()?.useRevision(domain, version.sig)
      return
    }

    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
    if (!history?.sign || !committer?.update) return

    const segments = [...item.segments]
    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig)
    const name = typeof layer?.['name'] === 'string' ? layer['name'] as string : (segments[segments.length - 1] ?? '')
    await committer.update(segments, { name, [WEBSITE_SLOT]: [version.sig] })
  }

  /** Walk the site's own lineage and keep each DISTINCT page it has shown.
   *  Commits that changed something other than the page contribute nothing.
   *
   *  A version's NUMBER is fixed at its first appearance and never reassigned:
   *  choosing v1 puts v1 back, it does not mint a "v4" — the number names the
   *  page, and a page whose name changed every time someone went back to it
   *  would be unciteable. Its TIME is the most recent commit that showed it, so
   *  the list still reads in the order the site actually moved through. */
  async #localVersions(item: AggregateItem): Promise<AggregateVersion[]> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!history?.sign || !history.listLayers || !history.getLayerBySig) return []

    try {
      const locationSig = await history.sign({ explorerSegments: () => item.segments })
      const entries = await history.listLayers(locationSig)

      const number = new Map<string, number>()
      const latest = new Map<string, number>()
      let head: string | null = null
      for (const entry of entries) {                     // oldest → newest
        const layer = await history.getLayerBySig(entry.layerSig)
        const pageSig = await this.#pageSigOf(layer)
        if (!pageSig) continue
        if (!number.has(pageSig)) number.set(pageSig, number.size + 1)
        latest.set(pageSig, entry.at)
        head = pageSig
      }

      return [...number].map(([sig, n]) => ({
        sig,
        label: `v${n}`,
        at: latest.get(sig),
        active: sig === head,
        origin: 'local' as const,
      })).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    } catch {
      return []
    }
  }

  /** The page a layer was showing: the first-class `website` slot, then the two
   *  legacy homes, in the SAME order the renderer mounts them (site-view.drone
   *  `resolvePageSig`) — a version list that disagreed with what opening the
   *  site actually shows would be worse than none. */
  async #pageSigOf(layer: LayerLike | null): Promise<string | null> {
    if (!layer) return null

    const direct = newestSlotSig(layer, WEBSITE_SLOT)
    if (direct) return direct

    const decorations = layer['decorations']
    if (Array.isArray(decorations)) {
      for (const raw of decorations) {
        const sig = String(raw)
        if (!SIG.test(sig)) continue
        const page = await this.#pageSigOfDecoration(sig)
        if (page) return page
      }
    }

    return newestSlotSig(layer, CONTEXT_SLOT)
  }

  /** Decoration sig → the page it carries, or null for any other kind. Cached:
   *  one decoration record is typically referenced by every layer since it was
   *  written, so a long lineage would otherwise re-read the same bytes once per
   *  entry. */
  async #pageSigOfDecoration(sig: string): Promise<string | null> {
    const cached = this.#decorationPages.get(sig)
    if (cached !== undefined) return cached

    let page: string | null = null
    try {
      const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
      const blob = await store?.getResource(sig)
      if (blob) {
        const record = JSON.parse(await blob.text()) as { kind?: string; payload?: { htmlSig?: unknown } }
        const htmlSig = String(record?.payload?.htmlSig ?? '')
        if (record?.kind === PAGE_KIND && SIG.test(htmlSig)) page = htmlSig
      }
    } catch { /* unreadable or not JSON — not a page */ }

    this.#decorationPages.set(sig, page)
    return page
  }

  /** The installer's deploy chain for whichever host serves this site.
   *
   *  MATCHED BY NAME, and that is a stated limitation rather than a design: the
   *  hive records no publish host on a site, so `humanity-centres` is paired
   *  with `humanity-centres.example.com` by its first hostname label. A miss
   *  simply yields no published rows — it never guesses a different site's
   *  chain. Once a site carries its host, this becomes an exact lookup and the
   *  name match goes away. */
  async #publishedVersions(item: AggregateItem): Promise<AggregateVersion[]> {
    const bridge = sentinel()
    if (!bridge?.revisions) return []

    try {
      const groups = await bridge.revisions()
      const wanted = new Set([slugify(item.label), ...item.segments.map(slugify)].filter(Boolean))

      const out: AggregateVersion[] = []
      for (const group of groups) {
        const host = String(group?.domain ?? '').toLowerCase().replace(/^www\./, '')
        if (!host) continue
        if (!wanted.has(slugify(host)) && !wanted.has(slugify(host.split('.')[0]))) continue

        for (const revision of group.revisions ?? []) {
          const rootSig = String(revision?.rootSig ?? '').toLowerCase()
          if (!SIG.test(rootSig)) continue
          const at = Date.parse(revision.deployedAt ?? '')
          out.push({
            sig: rootSig,
            label: revision.label || rootSig.slice(0, 8),
            at: Number.isFinite(at) ? at : undefined,
            active: rootSig === String(group.activeRootSig ?? '').toLowerCase(),
            origin: 'published',
            domain: group.domain,
          })
        }
      }
      return out
    } catch {
      return []
    }
  }

  readonly #decorationPages = new Map<string, string | null>()

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
