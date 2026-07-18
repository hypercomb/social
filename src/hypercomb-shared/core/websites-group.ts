// hypercomb-shared/core/websites-group.ts
//
// The "websites" launch group — surfaces the participant's registered sites
// as group members. Membership is the AGGREGATION LAYER (aggregation-layer.ts
// + documentation/aggregation-layer-model.md): the ['websites'] page layer's
// children ARE the menu, enable/disable are ordinary commits, and undo/redo
// is that location's normal history. Declared truth, curated by the
// participant, never derived from tree structure at read time.
//
// The old decoration-walk discovery survives ONLY as a one-time seed: on a
// profile that has never been seeded (websites-pool.ts sentinel), the walk
// runs once (topmost page-bearing cell per branch), commits its findings
// into the layer, and marks the seed done. After that, membership changes
// only through:
//   - a `website:build` event (a site built/upgraded at a scope enables it)
//   - the Beehaviors website row's switch (features-viewer)
//   - explicit curation (the landing page's remove affordance)
// Adopting or copying a page-stamped subtree does NOT touch the menu —
// membership is extrinsic and stays with the participant who declared it.
//
// Shell-level: HistoryService / Store / Navigation / ViewMode are resolved
// through window.ioc at call time (never imports essentials).

import { EffectBus } from '@hypercomb/core'
import { enableAggregation, listAggregation } from './aggregation-layer'
import { groupRegistry, type GroupMember } from './group-registry'
import { LaunchGroupBase } from './launch-group-base'
import { isSeeded, markSeeded } from './websites-pool'

const SIG = /^[0-9a-f]{64}$/
const PAGE_KIND = 'visual:website:page'
/** Depth guard for the seed walk — matches the build drone's MAX_DEPTH. */
const MAX_DEPTH = 24
const SITE = 'website'

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ decorations?: unknown; children?: unknown; website?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
}
type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type ViewModeLike = EventTarget & { mode?: string; setMode(next: string): void }

class WebsitesGroup extends LaunchGroupBase {
  override readonly id = 'websites'
  override readonly icon = 'language'
  override readonly label = 'Websites'
  readonly shape = 'flower-pot'
  /** Membership IS the ['websites'] layer — no reconcile, no cursor snap. */
  readonly curated = true

  #members: GroupMember[] = []
  #debounce: ReturnType<typeof setTimeout> | null = null
  #scanning = false
  /** Site roots whose `website` pheromone was ensured this session —
   *  avoids re-emitting the decoration trigger on every scan tick (the
   *  layer-level append is idempotent regardless). */
  #pheromoneStamped = new Set<string>()

  constructor() {
    super()
    // First read shortly after boot (let HistoryService/Store register), then
    // re-read whenever the aggregation layer changes.
    this.#scheduleScan(400)
    EffectBus.on<{ groupId?: string }>('aggregation:changed', p => {
      if (!p?.groupId || p.groupId === this.id) this.#scheduleScan()
    })
    // A site build/upgrade at a scope IS a declaration — enable its root.
    // One commit at ['websites'] (idempotent by path); the primitive emits
    // aggregation:changed, which refreshes the members.
    EffectBus.on<{ scope?: string; scopeSegments?: string[] }>('website:build', p => {
      const segs = (p?.scopeSegments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      if (p?.scope === 'root' || segs.length === 0) return   // '/' is not a menu entry
      void enableAggregation(this.id, segs)
    })
    // A website PAGE coming into existence IS the website declaring itself —
    // the feature's responsibility to surface its entry point (menu + icon).
    // Bridge/skill builds stamp pages via decoration-add and never emit
    // website:build, so listen to the decoration write itself. A page whose
    // cell already sits under a declared site root is a SUB-PAGE — part of
    // the route, never its own menu entry (the sitemap-root rule).
    EffectBus.on<{ segments?: string[]; op?: string; sig?: string }>('decorations:changed', p => {
      if (p?.op !== 'append' || !p.sig || !Array.isArray(p.segments)) return
      void this.#maybeEnableForPage(p.segments, p.sig)
    })
  }

  /** Enable the menu entry for a freshly stamped `visual:website:page` cell,
   *  unless it is (or lies under) an already-declared site root. Best-effort
   *  and cheap: one resource read to check the kind, and the aggregation
   *  read only when it matches. */
  async #maybeEnableForPage(rawSegments: string[], sig: string): Promise<void> {
    const segs = rawSegments.map(s => String(s ?? '').trim()).filter(Boolean)
    if (segs.length === 0 || !SIG.test(sig)) return
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return
    const blob = await store.getResource(sig).catch(() => null)
    if (!blob) return
    try {
      if ((JSON.parse(await blob.text()) as { kind?: string })?.kind !== PAGE_KIND) return
    } catch { return }
    // The sitemap-root rule must hold against LAYER TRUTH, not just the menu
    // projection: during a multi-page build the root's own enable commit can
    // still be riding the committer FIFO when the next page's decoration
    // event fires — the projection check below misses it and a SUB-PAGE gets
    // promoted to its own menu entry (the "extra Journal website"). An
    // ancestor cell carrying a page decoration is authoritative: sub-page.
    if (await this.#hasAncestorPage(segs)) return
    const key = segs.join('/')
    for (const m of await listAggregation(this.id)) {
      const mk = m.segments.join('/')
      if (key === mk || key.startsWith(mk + '/')) return   // re-stamp or sub-page
    }
    void enableAggregation(this.id, segs)
  }

  /** True when any strict ancestor of `segs` carries its own
   *  `visual:website:page` decoration — read from the layers (truth),
   *  race-free against in-flight aggregation commits. */
  async #hasAncestorPage(segs: readonly string[]): Promise<boolean> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!history || !store?.getResource) return false
    for (let depth = segs.length - 1; depth >= 1; depth--) {
      const prefix = segs.slice(0, depth)
      const locSig = await history.sign({ explorerSegments: () => prefix }).catch(() => null)
      if (!locSig) continue
      const layer = await history.currentLayerAt(locSig).catch(() => null)
      const decos = Array.isArray(layer?.decorations) ? layer.decorations : []
      for (const entry of decos) {
        const dsig = String(entry ?? '')
        if (!SIG.test(dsig)) continue
        const dblob = await store.getResource(dsig).catch(() => null)
        if (!dblob) continue
        try {
          if ((JSON.parse(await dblob.text()) as { kind?: string })?.kind === PAGE_KIND) return true
        } catch { /* malformed — skip */ }
      }
    }
    return false
  }

  override members(): GroupMember[] { return this.#members }

  protected override activate(m: GroupMember): void {
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    // Navigate first (synchronous dispatch updates the lineage) so the site
    // renderer captures THIS site's root as the entry floor when the surface
    // flips.
    nav?.goRaw?.(m.segments)
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    vm?.setMode?.(SITE)
  }

  /** Ensure the cell at `segments` carries the `website` tag decoration.
   *  DecorationService lives in essentials — resolved via IoC at call time
   *  (shared never imports essentials). Un-marks the session guard on
   *  failure so a later scan retries (e.g. essentials not loaded yet). */
  async #ensureWebsitePheromone(segments: readonly string[]): Promise<void> {
    if (segments.length === 0) return
    const key = segments.join('/')
    if (this.#pheromoneStamped.has(key)) return
    this.#pheromoneStamped.add(key)
    const deco = get<{ addTag?: (s: readonly string[], name: string) => Promise<string> }>(
      '@diamondcoreprocessor.com/DecorationService',
    )
    if (!deco?.addTag) { this.#pheromoneStamped.delete(key); return }
    try { await deco.addTag(segments, 'website') } catch { this.#pheromoneStamped.delete(key) }
  }

  #scheduleScan(delay = 450): void {
    if (this.#debounce) clearTimeout(this.#debounce)
    this.#debounce = setTimeout(() => { this.#debounce = null; void this.#scan() }, delay)
  }

  async #scan(): Promise<void> {
    // A trigger landing while a scan is in flight must DEFER, not drop —
    // dropping it left the members stale after an enable whose commit rode
    // a busy committer FIFO (icon never appeared for the first website).
    if (this.#scanning) { this.#scheduleScan(250); return }
    this.#scanning = true
    try {
      const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
      const store = get<StoreLike>('@hypercomb.social/Store')
      if (!history || !store?.getResource || !store?.getPool) { this.#scheduleScan(700); return }   // boot not ready — retry

      // One-time migration: fold the legacy decoration walk into the layer —
      // one enable commit per discovered site root. Launcher cells live at
      // ['websites', <label>], so a duplicate label (two sites named
      // 'dolphin' on different branches) must disambiguate or the second
      // enable would land on the first one's child location.
      if (!(await isSeeded())) {
        const legacy = await findWebsiteSites(history, store)
        const used = new Set<string>()
        for (const m of legacy) {
          let label = m.label
          let n = 2
          while (used.has(label)) label = `${m.label} (${n++})`
          used.add(label)
          await enableAggregation(this.id, m.segments, { label, icon: m.icon })
        }
        await markSeeded()
      }

      this.#members = (await listAggregation(this.id))
        .map(r => ({
          key: JSON.stringify(r.segments),
          label: r.label || r.segments[r.segments.length - 1],
          segments: r.segments,
          icon: r.icon || 'web',
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
      // Pheromone stamp: a declared site root carries the author's `website`
      // tag in its OWN layer decorations (a tag IS the author's pheromone —
      // documentation/pheromones.md), so websites surface through the
      // existing tag reach filter and the mark travels with adoption.
      // Covers new declarations AND back-fills roots declared before this
      // existed; duplicate appends no-op at the layer machine.
      for (const m of this.#members) void this.#ensureWebsitePheromone(m.segments)
      groupRegistry.notifyChanged()
    } finally {
      this.#scanning = false
    }
  }
}

/** SEED WALK (one-time, per profile). Walk the tree from the hive root,
 *  returning one member per SITE ROOT (the topmost page-bearing cell on each
 *  branch). Stops descending once a root is found. A cell whose decorations
 *  cannot all be resolved is OPAQUE: it is neither classified as a site nor
 *  descended into — a missing blob must not promote a site's sub-pages into
 *  the menu (the availability fall-through that polluted the directory). */
async function findWebsiteSites(history: HistoryLike, store: StoreLike): Promise<GroupMember[]> {
  const out: GroupMember[] = []
  const visited = new Set<string>()

  const childNames = async (layer: { children?: unknown }): Promise<string[]> => {
    const children = Array.isArray(layer?.children) ? layer.children : []
    const names: string[] = []
    for (const entry of children) {
      const s = String(entry ?? '').trim()
      if (!s) continue
      if (SIG.test(s)) {
        const child = await history.getLayerBySig(s).catch(() => null)
        const n = child?.name
        if (typeof n === 'string' && n) names.push(n)
      } else {
        names.push(s)
      }
    }
    return names
  }

  /** A site's identity at this cell: its page-decoration payload (icon/label),
   *  `{}` for a first-class `website`-slot page, `'opaque'` when a decoration
   *  sig failed to resolve (classification unknowable — prune the branch), or
   *  null when the cell provably carries no page. */
  const siteAt = async (
    layer: { decorations?: unknown; website?: unknown },
  ): Promise<{ icon: string; label: string } | 'opaque' | null> => {
    const decos = Array.isArray(layer?.decorations) ? layer.decorations : []
    let unresolved = false
    for (const entry of decos) {
      const sig = String(entry ?? '')
      if (!SIG.test(sig)) continue
      const blob = await store.getResource(sig).catch(() => null)
      if (!blob) { unresolved = true; continue }
      try {
        const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { icon?: unknown; label?: unknown } }
        if (rec?.kind === PAGE_KIND) {
          const p = rec.payload ?? {}
          return {
            icon: typeof p.icon === 'string' ? p.icon.trim() : '',
            label: typeof p.label === 'string' ? p.label.trim() : '',
          }
        }
      } catch { /* malformed — skip */ }
    }
    const slot = layer?.website
    if (Array.isArray(slot) && slot.some(s => SIG.test(String(s)))) return { icon: '', label: '' }
    return unresolved ? 'opaque' : null
  }

  const walk = async (segments: string[], depth: number): Promise<void> => {
    if (depth < 0) return
    const key = segments.join('/')
    if (visited.has(key)) return
    visited.add(key)
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => null)
    if (!locSig) return
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return
    const site = await siteAt(layer)
    if (site === 'opaque') return   // unknowable — never promote sub-pages
    if (site) {
      const label = site.label || (segments.length ? segments[segments.length - 1] : '/')
      out.push({ key: JSON.stringify(segments), label, segments: [...segments], icon: site.icon || 'web' })
      return   // site root found — the whole site is one entry; don't descend
    }
    for (const name of await childNames(layer)) await walk([...segments, name], depth - 1)
  }

  await walk([], MAX_DEPTH)
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

groupRegistry.register(new WebsitesGroup())
