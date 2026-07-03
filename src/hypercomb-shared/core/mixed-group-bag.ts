// hypercomb-shared/core/mixed-group-bag.ts
//
// MixedGroupBag — ONE shared positional aggregator page (`agg-mix`) that shows
// the members of the group being VIEWED. ONE-STATE (2026-07-03): the launcher
// icons are portals, not toggles — show(id) brings this page up for that group,
// showing another group replaces it (one at a time), and the page simply STAYS
// until the participant navigates like on any other page. No enabled set, no
// mode-reset safety net, no exit choreography, and NO special leave gestures:
// Escape and right-click mean here exactly what they mean on every page.
// "Which group" is one session-local field (#groupId) and "is it showing" is
// derived from the current lineage location (isActive()).
//
// Mirrors DashboardBee: a real lineage bag you NAVIGATE INTO, so "current
// lineage location = where edits commit" makes arrangement persist. Committed
// LEAF-ONLY (its opaque segment is never linked into root's children) so it
// never appears as a stray tile and the website scan never reaches it.
//
// Cross-module contract: the opaque segment is `agg-mix`, under the shared
// `agg-` prefix. essentials/show-cell.drone.ts gives `agg-`-prefixed locations
// the launcher silhouette + drift, and tile-overlay.drone.ts routes a launcher
// tile click back as `group:open { label }`. Those modules MUST NOT import
// shared (CLAUDE.md), so the prefix is mirrored by string, never imported — a
// rename has to touch show-cell, tile-overlay, and this file together.
//
// The bag is constructed EAGERLY by GroupRegistry (not lazily on first click):
// its `group:open` listener must be live even after a refresh that reloads
// straight INTO `agg-mix`, otherwise the launcher tiles render but every click
// is a dead no-op. The listener rebuilds its routing maps on each click, so it
// routes correctly regardless of whether a show happened this session.
//
// Shell-level: every essentials service is resolved through window.ioc at call
// time. Never imports essentials.

import { EffectBus } from '@hypercomb/core'
import type { GroupMember, LaunchGroup, GroupRegistry } from './group-registry'

const LAUNCH_KIND = 'launch:target'
const SIG = /^[0-9a-f]{64}$/

type LineageLike = { domain?: () => string; explorerSegments?: () => readonly string[] }
type HistoryLike = {
  sign(l: LineageLike): Promise<string>
  commitLayer(locationSig: string, layer: { name?: string; [slot: string]: unknown }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ children?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
  latestMarkerSigFor(locationSig: string, name: string): Promise<string>
}
type NavigationLike = { goRaw?: (segments: readonly string[]) => void; replaceRaw?: (segments: readonly string[]) => void }
type ViewModeLike = EventTarget & { mode?: string }
type DashboardLike = { isActive?: () => boolean }
type StoreLike = { putResource(blob: Blob): Promise<string> }
type IocLike = { whenReady?: (key: string, cb: (v: unknown) => void) => void }

export class MixedGroupBag {
  #registry: GroupRegistry
  #segments = ['agg-mix']
  #returnSegments: string[] = []
  /** The group this page currently shows (last shown). Session-local, never
   *  persisted — the ONE state. Null until the first show(). */
  #groupId: string | null = null
  /** Final (collision-resolved) cell label → its member / owning group. Rebuilt
   *  on every projection so a click routes to the right group's open(). */
  #memberByLabel = new Map<string, GroupMember>()
  #groupByLabel = new Map<string, LaunchGroup>()
  /** Hive location of the site opened from the list this session, or null. */
  #lastOpenedSegments: string[] | null = null
  /** Serializes show()/refresh so two rapid clicks can't both observe
   *  isActive()===false and double-enter. */
  #syncing: Promise<void> = Promise.resolve()
  /** Last (group + member-label) signature already warmed by prewarm(), so
   *  the per-discovery-scan re-trigger is a cheap no-op once warm. */
  #prewarmedKey = ''

  constructor(registry: GroupRegistry) {
    this.#registry = registry
    // A launcher-tile click surfaces as `group:open { label }` (tile-overlay).
    // ONE listener for the whole mix — rebuild the routing maps, then resolve
    // the member AND its owning group from the label and route to that group's
    // existing open() verbatim. Rebuilding per click keeps routing correct after
    // a refresh (maps cold) or a background member change (maps stale).
    EffectBus.on<{ label?: string }>('group:open', ({ label }) => {
      if (!label || !this.isActive()) return
      this.#members()
      const member = this.#memberByLabel.get(label)
      const group = this.#groupByLabel.get(label)
      if (!member || !group) return
      // Members WITH a hive location (websites) take over a transient surface
      // at their OWN location, navigating us out of the bag: remember where the
      // site lives so the bag's own exit() back-drills onto it. Closing that
      // surface is the surface's own business — no launcher reset follows
      // (one-state: there is no launcher state to reset).
      if (member.segments.length > 0) this.#lastOpenedSegments = [...member.segments]
      group.open(member)
    })
  }

  /** True when the participant is currently inside the mixed bag. */
  isActive(): boolean {
    const segs = this.#currentSegments()
    return segs.length > 0 && segs[0] === this.#segments[0]
  }

  /** The group whose layer the participant is standing in, or null when the
   *  participant is elsewhere. DERIVED — location is the state. */
  currentGroupId(): string | null { return this.isActive() ? this.#groupId : null }

  /** The launcher icon click. Serialized so overlapping clicks resolve in
   *  order. Idempotent when already standing in this group's layer. */
  show(id: string): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#showOnce(id)).catch(() => { /* keep the chain alive */ })
    return this.#syncing
  }

  async #showOnce(id: string): Promise<void> {
    if (this.#groupId === id && this.isActive()) return   // already up — one state
    this.#groupId = id
    if (this.isActive()) {
      // Standing in the bag showing another group — replace in place.
      await this.#reconcileAndRepaint()
      return
    }
    // Elsewhere (hive, a website surface, the dashboard): leave any open member
    // surface and navigate to the page. Tap games → see games.
    this.#dismissActiveSurface()
    await this.enter(true)
  }

  /** A group's member set changed in the background (a site discovered, a game
   *  registered). Serialized with show(); only ever updates IN PLACE — never
   *  auto-enters, which would yank the participant into the bag on a background
   *  scan (stillness rule). */
  refreshIfActive(): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#refreshOnce()).catch(() => {})
    return this.#syncing
  }

  /** Background, NON-NAVIGATING cache warm so the first click into the launcher
   *  is fast. Discovery settling (GroupRegistry.notifyChanged) calls this; it
   *  primes the SAME history caches the click's #reconcile reads — the agg-mix
   *  head and every launcher child's head — using currentLayerAt, which is
   *  strictly read-only (see #warmAgg: absent bag returns silently, NO
   *  minting). It never commits, never writes a decoration, never navigates, so
   *  the screen never moves (stillness rule). Serialized on #syncing so it can't
   *  race a real show; a show that lands mid-warm reconciles afterwards over
   *  a warm cache (and commitLayer dedups when nothing changed). */
  prewarm(): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#prewarmOnce()).catch(() => {})
    return this.#syncing
  }

  /** Warm a SPECIFIC group's aggregator on INTENT (icon hover) — even before it
   *  is shown — so the FIRST click into it is fast, not just later ones. The
   *  agg-mix location is the same whatever group is shown; only the launcher
   *  children differ, so we warm this group's members' heads. Same read-only
   *  currentLayerAt warm as prewarm(); no-op while already active. */
  prewarmFor(groupId: string): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#prewarmForOnce(groupId)).catch(() => {})
    return this.#syncing
  }

  async #prewarmForOnce(groupId: string): Promise<void> {
    if (this.isActive()) return
    const members = this.#registry.get(groupId)?.members() ?? []
    if (members.length === 0) return
    const key = 'hover:' + groupId + '|' + members.map(m => m.label).join('')
    if (key === this.#prewarmedKey) return
    if (await this.#warmAgg(members.map(m => m.label))) this.#prewarmedKey = key
  }

  /** Read-only warm of the agg-mix head + the given launcher-child labels' heads
   *  via currentLayerAt (mints nothing — see #warmAgg). Shared by the
   *  current-group prewarm and the per-group hover prewarm. Never commits /
   *  writes / navigates. Returns true once the warm actually ran. */
  async #warmAgg(labels: readonly string[]): Promise<boolean> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return false
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const domain = lineage?.domain
    const bagLocSig = await history.sign({ domain, explorerSegments: () => this.#segments }).catch(() => '')
    if (!bagLocSig) return false
    await history.currentLayerAt(bagLocSig).catch(() => null)
    await Promise.all(labels.map(async label => {
      const childLocSig = await history
        .sign({ domain, explorerSegments: () => [...this.#segments, label] })
        .catch(() => '')
      if (childLocSig) await history.currentLayerAt(childLocSig).catch(() => null)
    }))
    return true
  }

  async #prewarmOnce(): Promise<void> {
    if (!this.#groupId) return              // nothing shown yet — no likely destination
    if (this.isActive()) return             // already inside — refreshIfActive owns it
    const members = this.#members()
    if (members.length === 0) return
    // Cheap idempotence: skip when this exact projection is already warm.
    // Discovery re-fires notifyChanged on every scan; after the first warm these
    // are currentLayerAt cache hits anyway, but the key check avoids the OPFS
    // dir listings entirely.
    const key = this.#groupId + '|' + members.map(m => m.label).join('')
    if (key === this.#prewarmedKey) return
    if (await this.#warmAgg(members.map(m => m.label))) this.#prewarmedKey = key
  }

  /** Leave a ViewMode render surface (website/tutor) so the mixed page is
   *  visible. The dashboard bag is hexagons-mode and is left by enter()'s
   *  goRaw, so only a ViewMode flip back to hexagons is needed here. */
  #dismissActiveSurface(): void {
    const vm = get<ViewModeLike & { setMode?: (m: string) => void }>('@hypercomb.social/ViewMode')
    if (vm?.mode && vm.mode !== 'hexagons') vm.setMode?.('hexagons')
  }

  async #refreshOnce(): Promise<void> {
    if (!this.isActive()) return
    await this.#reconcileAndRepaint()
  }

  /** Reconcile the bag to the shown group's members, then navigate into it.
   *  `force` (an explicit icon click) navigates even from another member
   *  surface — see #showOnce; a background entry still defers via canEnter(). */
  async enter(force = false): Promise<void> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!history || !nav?.goRaw) {
      // Too early (HistoryService not registered yet) — retry once it's up,
      // routing through show() so it re-reads the shown group at fire time.
      const ioc = (window as unknown as { ioc?: IocLike }).ioc
      ioc?.whenReady?.('@diamondcoreprocessor.com/HistoryService', () => {
        const g = this.#groupId
        if (g) void this.show(g)
      })
      return
    }
    if (!this.#groupId) return
    this.#lastOpenedSegments = null   // fresh session — nothing opened from the list yet

    // Don't capture a bag/dashboard segment as the return target — return to the
    // last REAL page so leaving the mix lands somewhere meaningful.
    const captureReturn = (): void => {
      const cur = this.#currentSegments()
      if (!(cur[0]?.startsWith('agg-') || cur[0]?.startsWith('dash-'))) this.#returnSegments = cur
    }

    if (force) {
      // Explicit pick (an icon click): reconcile the bag to the picked group's
      // members FIRST — fully replacing whatever the previous group committed —
      // THEN reset the render caches and navigate. Committing before the
      // navigate means the first paint at agg-mix reads the NEW children;
      // emitting `launcher:reconciled` before the (synchronous) goRaw clears
      // show-cell's cell cache so the landing render can't serve the previous
      // group's tiles. Net: switching groups never flashes / sticks on the old
      // content. The reconcile reads warm caches after prewarm(), so the commit
      // is cheap.
      captureReturn()
      await this.#reconcile(history)
      EffectBus.emit('launcher:reconciled', { segments: this.#segments })
      nav.goRaw(this.#segments)
      return
    }

    // Background entry: reconcile FIRST so we never navigate into an empty/stale
    // bag, and defer to canEnter() so a background scan can't yank the participant
    // off a surface.
    await this.#reconcile(history)
    if (this.#members().length === 0 || !this.#canEnter()) return
    captureReturn()
    nav.goRaw(this.#segments)
  }

  /** Leave the bag. After a site was opened this session, back out onto that
   *  site's OWN hive cell so the participant can explore its hive; otherwise
   *  return to where the list was first entered from. */
  exit(): void {
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    nav?.goRaw?.(this.#lastOpenedSegments ?? this.#returnSegments)
  }

  /** Whether it's safe to NAVIGATE into the bag right now. False when another
   *  member surface owns the screen (a render view like website, or the
   *  dashboard bag) — a background refresh must update in place, never eject
   *  the participant onto agg-mix. Games/help mount overlays that keep the
   *  lineage on agg-mix, so they read as active (the reconcile-in-place
   *  branch), not here. */
  #canEnter(): boolean {
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    if (vm?.mode && vm.mode !== 'hexagons') return false
    const dash = get<DashboardLike>('@diamondcoreprocessor.com/DashboardBee')
    if (dash?.isActive?.()) return false
    return true
  }

  // ── projection (the shown group + collision-resolved labels) ─────────────

  /** The shown group's members, with deterministic labels and the
   *  label→{member,group} maps the click route reads. A duplicate label within
   *  the group is suffixed `Label (2)` so routing stays exact. */
  #members(): GroupMember[] {
    this.#memberByLabel.clear()
    this.#groupByLabel.clear()
    const group = this.#groupId ? this.#registry.get(this.#groupId) : undefined
    if (!group) return []
    const out: GroupMember[] = []
    for (const m of group.members()) {
      let label = m.label
      let n = 2
      while (this.#memberByLabel.has(label)) label = `${m.label} (${n++})`
      const member = label === m.label ? m : { ...m, label }
      this.#memberByLabel.set(label, member)
      this.#groupByLabel.set(label, group)
      out.push(member)
    }
    return out
  }

  // ── reconcile ──────────────────────────────────────────────────────────

  async #reconcileAndRepaint(): Promise<void> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!history) return
    await this.#reconcile(history)
    // The lineage location is unchanged (still agg-mix), so a bare same-location
    // navigate is swallowed by show-cell's fast-path skip. This force-repaint
    // signal makes show-cell drop its render cache and re-read the new children
    // (the launcher tiles mix in/out live). The navigate is kept as a belt-and-
    // braces nudge.
    EffectBus.emit('launcher:reconciled', { segments: this.#segments })
    ;(nav?.replaceRaw ?? nav?.goRaw)?.(this.#segments)
  }

  /** Diff the bag's launcher cells against the shown group's members: keep
   *  existing in place (preserving arrangement), append new, drop removed.
   *  Commit LEAF-ONLY so the bag is never linked into a parent. */
  async #reconcile(history: HistoryLike): Promise<void> {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const domain = lineage?.domain
    const members = this.#members()

    const bagLocSig = await history.sign({ domain, explorerSegments: () => this.#segments })
    const layer = await history.currentLayerAt(bagLocSig).catch(() => null)
    const existing = await this.#childNames(history, layer)

    const wanted = members.map(m => m.label)
    const wantedSet = new Set(wanted)
    const kept = existing.filter(n => wantedSet.has(n))          // preserve order
    const fresh = wanted.filter(n => !existing.includes(n))      // append new
    const order = [...kept, ...fresh]

    const store = get<StoreLike>('@hypercomb.social/Store')
    // 1. Create any FRESH launcher cells first — DETERMINISTICALLY, capturing each
    //    one's committed marker. We put the `launch:target` decoration resource
    //    ourselves and commit the child layer with it in ONE awaited step. Going
    //    through DecorationService.write would only REQUEST an async slot-commit,
    //    so the parallel latestMarkerSigFor below would race it and link the EMPTY
    //    00000000 marker — the tile (and its shape) would not render until a later
    //    reconcile/reload. The owning group's silhouette travels in the payload so
    //    show-cell renders each tile in its OWN group's shape (websites → flower-pot,
    //    games → space-invader); the decorations:changed emit warms the kind-index /
    //    shape-index synchronously. (NOT a website page, so the website scan never
    //    re-discovers it as a site.) This mirrors how the PARENT bag is committed
    //    below — a direct history.commitLayer, not the async committer machine.
    const freshMarker = new Map<string, string>()
    if (store?.putResource) {
      for (const name of fresh) {
        const m = this.#memberByLabel.get(name)
        const shape = this.#groupByLabel.get(name)?.shape ?? ''
        const childSegs = [...this.#segments, name]
        try {
          const record = { kind: LAUNCH_KIND, appliesTo: [], payload: { segments: m?.segments ?? [], icon: m?.icon ?? '', label: name, shape, key: m?.key ?? '' } }
          const decoSig = await store.putResource(new Blob([JSON.stringify(record)], { type: 'application/json' }))
          const childLocSig = await history.sign({ domain, explorerSegments: () => childSegs })
          const marker = await history.commitLayer(childLocSig, { name, decorations: [decoSig] })
          if (marker && SIG.test(marker)) freshMarker.set(name, marker)
          EffectBus.emit('decorations:changed', { segments: childSegs, op: 'append', sig: decoSig })
        } catch { /* fall through to the marker read below */ }
      }
    }
    // 2. Resolve every child's marker sig. Fresh cells use the marker we just
    //    committed (deterministic — no empty-marker race); kept cells read their
    //    existing head IN PARALLEL. Promise.all preserves `order`, so arrangement
    //    is unchanged; empties filter out.
    const resolved = await Promise.all(order.map(async name => {
      const pre = freshMarker.get(name)
      if (pre) return pre
      const childLocSig = await history.sign({ domain, explorerSegments: () => [...this.#segments, name] })
      const childSig = await history.latestMarkerSigFor(childLocSig, name).catch(() => '')
      return childSig && SIG.test(childSig) ? childSig : ''
    }))
    const childSigs = resolved.filter(s => s !== '')

    await history.commitLayer(bagLocSig, { name: this.#segments[0], children: childSigs })

    // The leaf commit above goes straight through history.commitLayer, bypassing
    // LayerCommitter — so the history cursor and the lineage layer memo never learn
    // a new head landed here. Left alone, re-showing while standing in the bag
    // leaves the cursor one marker behind head ("rewound"), and show-cell's
    // rewound-render path paints the PREVIOUS group's committed layer — the
    // "switched group but old content / looks hung" bug under rapid switches. Drop
    // the lineage memo and force the cursor to head for THIS bag so the next render
    // reads the freshly-committed children. (On a fresh icon-click entry the cursor is
    // still bound to the prior location: refreshForLocation no-ops there and the
    // post-nav cursor.load lands at head on its own, so the guarded jumpToLatest is
    // correctly skipped.)
    get<{ invalidate?: () => void }>('@hypercomb.social/Lineage')?.invalidate?.()
    const cursor = get<{
      refreshForLocation?: (s: string) => Promise<void>
      jumpToLatest?: () => void
      state?: { locationSig?: string }
    }>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.refreshForLocation) {
      await cursor.refreshForLocation(bagLocSig)
      if (cursor.state?.locationSig === bagLocSig) cursor.jumpToLatest?.()
    }
  }

  async #childNames(history: HistoryLike, layer: { children?: unknown } | null): Promise<string[]> {
    const children = Array.isArray(layer?.children) ? layer!.children as unknown[] : []
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

  // ── helpers ──────────────────────────────────────────────────────────────

  #currentSegments(): string[] {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }
}
