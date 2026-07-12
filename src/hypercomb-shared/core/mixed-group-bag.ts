// hypercomb-shared/core/mixed-group-bag.ts
//
// MixedGroupBag — each launch group's page lives at its OWN single-segment
// ROOT location named by the group id: /games, /websites, /dashboard, /help.
// The old opaque `agg-mix` union page is gone (2026-07-03): the route's first
// segment is a VARIABLE root — whatever tree is active at that name — so every
// group page is directly ADDRESSABLE (type /games and land on it) and each is
// its own leaf-only lineage: a separate pool that is never linked into the
// hive root's children, viewable at root level with a different pool lineage.
//
// ONE-STATE: the launcher icons are portals, not toggles — show(id) navigates
// to that group's page, showing another group is a plain navigation to a
// different location, and the page simply STAYS until the participant
// navigates like on any other page. The LOCATION IS THE STATE: active/current
// derive from the lineage segments against the registry's group ids, so a
// cold reload or a typed address works with no show() having happened.
//
// SWARM: joining the swarm (mesh → public) ESCAPES any launcher page — these
// pages are participant-local chrome on their own roots, so going public
// lands back on the participant's real page and THAT is what the swarm sees.
//
// Mirrors DashboardBee: a real lineage bag you NAVIGATE INTO, so "current
// lineage location = where edits commit" makes arrangement persist per group.
//
// Cross-module contract: essentials (show-cell, tile-overlay, action-card)
// detect a launcher page by resolving the single segment against the
// GroupLauncher registry over IoC at call time (never imported); legacy
// `agg-` locations still read as launcher pages so old history renders.
//
// The bag is constructed EAGERLY by GroupRegistry (not lazily on first click):
// its `group:open` listener must be live even after a refresh that reloads
// straight INTO a group page, otherwise the launcher tiles render but every
// click is a dead no-op. The listener rebuilds its routing maps on each click,
// so it routes correctly regardless of whether a show happened this session.
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
type CommitterLike = { commitSlotSet(segments: readonly string[], slot: string, sigs: readonly string[]): Promise<void> }
type IocLike = { whenReady?: (key: string, cb: (v: unknown) => void) => void }

export class MixedGroupBag {
  #registry: GroupRegistry
  #returnSegments: string[] = []
  /** The group last shown via show() — a session-local hint for prewarm and
   *  the enter() retry; the CURRENT group always derives from the location
   *  (currentGroupId). Null until the first show(). */
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
      const id = this.currentGroupId()
      if (!label || !id) return
      this.#members(id)
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

    // Joining the swarm ESCAPES any launcher page: group pages are
    // participant-local chrome on their own root lineages, so going public
    // must land the participant back on their REAL page — the swarm sees the
    // current content page's tiles, never the launcher. Only a live JOIN
    // (private → public) escapes: EffectBus replays the last emit on
    // subscribe, so a profile that BOOTS public would otherwise yank a cold
    // /games address straight back to the hive.
    let prevPublic: boolean | null = null
    EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => {
      const pub = p?.public === true
      const was = prevPublic
      prevPublic = pub
      if (was === false && pub && this.isActive()) this.exit()
    })
  }

  /** A group's page location: its id as the single ROOT segment (/games). */
  #segsFor(id: string): string[] { return [id] }

  /** True when the participant is standing in ANY group's page — derived from
   *  the location: a single-segment root whose name is a registered group id.
   *  Cold reloads and typed addresses (/games) count; no show() needed. */
  isActive(): boolean { return this.currentGroupId() !== null }

  /** The group whose page the participant is standing in, or null when the
   *  participant is elsewhere. DERIVED — the location is the state. */
  currentGroupId(): string | null {
    const segs = this.#currentSegments()
    if (segs.length !== 1) return null
    const g = this.#registry.get(segs[0])
    // An openDirectly group (the dashboard) has no page, so standing at its id
    // segment is NOT standing in a launcher page — it renders as a normal
    // location (and the fix ensures we never navigate there in the first place).
    return g && !g.openDirectly ? segs[0] : null
  }

  /** The launcher icon click. Serialized so overlapping clicks resolve in
   *  order. Idempotent when already standing in this group's layer. */
  show(id: string): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#showOnce(id)).catch(() => { /* keep the chain alive */ })
    return this.#syncing
  }

  async #showOnce(id: string): Promise<void> {
    this.#groupId = id
    if (this.currentGroupId() === id) {
      // Already standing in this group's page — refresh it in place.
      await this.#reconcileAndRepaint(id)
      return
    }
    // Elsewhere (hive, another group's page, a website surface, the
    // dashboard): leave any open member surface and navigate to the page.
    // Tap games → land on /games.
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
   *  primes the SAME history caches the click's #reconcile reads — the group
   *  page's head and every launcher child's head — using currentLayerAt, which
   *  is strictly read-only (see #warmGroup: absent bag returns silently, NO
   *  minting). It never commits, never writes a decoration, never navigates, so
   *  the screen never moves (stillness rule). Serialized on #syncing so it can't
   *  race a real show; a show that lands mid-warm reconciles afterwards over
   *  a warm cache (and commitLayer dedups when nothing changed). */
  prewarm(): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#prewarmOnce()).catch(() => {})
    return this.#syncing
  }

  /** Warm a SPECIFIC group's page on INTENT (icon hover) — even before it is
   *  shown — so the FIRST click into it is fast, not just later ones. Same
   *  read-only currentLayerAt warm as prewarm(); no-op while already active. */
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
    if (await this.#warmGroup(groupId, members.map(m => m.label))) this.#prewarmedKey = key
  }

  /** Read-only warm of a group page's head + the given launcher-child labels'
   *  heads via currentLayerAt (mints nothing). Shared by the last-shown prewarm
   *  and the per-group hover prewarm. Never commits / writes / navigates.
   *  Returns true once the warm actually ran. */
  async #warmGroup(id: string, labels: readonly string[]): Promise<boolean> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return false
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const domain = lineage?.domain
    const segs = this.#segsFor(id)
    const bagLocSig = await history.sign({ domain, explorerSegments: () => segs }).catch(() => '')
    if (!bagLocSig) return false
    await history.currentLayerAt(bagLocSig).catch(() => null)
    await Promise.all(labels.map(async label => {
      const childLocSig = await history
        .sign({ domain, explorerSegments: () => [...segs, label] })
        .catch(() => '')
      if (childLocSig) await history.currentLayerAt(childLocSig).catch(() => null)
    }))
    return true
  }

  async #prewarmOnce(): Promise<void> {
    const id = this.#groupId
    if (!id) return                         // nothing shown yet — no likely destination
    if (this.isActive()) return             // already inside — refreshIfActive owns it
    const members = this.#members(id)
    if (members.length === 0) return
    // Cheap idempotence: skip when this exact projection is already warm.
    // Discovery re-fires notifyChanged on every scan; after the first warm these
    // are currentLayerAt cache hits anyway, but the key check avoids the OPFS
    // dir listings entirely.
    const key = id + '|' + members.map(m => m.label).join('')
    if (key === this.#prewarmedKey) return
    if (await this.#warmGroup(id, members.map(m => m.label))) this.#prewarmedKey = key
  }

  /** Leave a ViewMode render surface (website/tutor) so the mixed page is
   *  visible. The dashboard bag is hexagons-mode and is left by enter()'s
   *  goRaw, so only a ViewMode flip back to hexagons is needed here. */
  #dismissActiveSurface(): void {
    const vm = get<ViewModeLike & { setMode?: (m: string) => void }>('@hypercomb.social/ViewMode')
    if (vm?.mode && vm.mode !== 'hexagons') vm.setMode?.('hexagons')
  }

  async #refreshOnce(): Promise<void> {
    const id = this.currentGroupId()
    if (!id) return
    await this.#reconcileAndRepaint(id)
  }

  /** Reconcile the last-shown group's page to its members, then navigate into
   *  it. `force` (an explicit icon click) navigates even from another member
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
    const id = this.#groupId
    if (!id) return
    const segs = this.#segsFor(id)
    this.#lastOpenedSegments = null   // fresh session — nothing opened from the list yet

    // Don't capture a launcher/dashboard segment as the return target — return
    // to the last REAL page so leaving a group page lands somewhere meaningful.
    const captureReturn = (): void => {
      const cur = this.#currentSegments()
      const onChrome = (cur.length === 1 && !!this.#registry.get(cur[0]))
        || cur[0]?.startsWith('agg-') || cur[0]?.startsWith('dash-')
      if (!onChrome) this.#returnSegments = cur
    }

    if (force) {
      // Explicit pick (an icon click): reconcile the page to the picked group's
      // members FIRST, THEN reset the render caches and navigate. Committing
      // before the navigate means the first paint at /<group> reads the fresh
      // children; `launcher:reconciled` before the (synchronous) goRaw clears
      // show-cell's cell cache. Group switches are now REAL navigations between
      // distinct locations, so the old same-location stale-render trap doesn't
      // apply — the emit stays as the repaint nudge for re-entering the SAME
      // group's page.
      captureReturn()
      await this.#reconcile(history, id)
      EffectBus.emit('launcher:reconciled', { segments: segs })
      nav.goRaw(segs)
      return
    }

    // Background entry: reconcile FIRST so we never navigate into an empty/stale
    // bag, and defer to canEnter() so a background scan can't yank the participant
    // off a surface.
    await this.#reconcile(history, id)
    if (this.#members(id).length === 0 || !this.#canEnter()) return
    captureReturn()
    nav.goRaw(segs)
  }

  /** Leave the bag. After a site was opened this session, back out onto that
   *  site's OWN hive cell so the participant can explore its hive; otherwise
   *  return to where the list was first entered from. */
  exit(): void {
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    nav?.goRaw?.(this.#lastOpenedSegments ?? this.#returnSegments)
  }

  /** Whether it's safe to NAVIGATE into a group page right now. False when
   *  another member surface owns the screen (a render view like website, or
   *  the dashboard bag) — a background refresh must update in place, never
   *  eject the participant onto a launcher page. Games/help overlays keep the
   *  lineage on the group page, so they read as active (the
   *  reconcile-in-place branch), not here. */
  #canEnter(): boolean {
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    if (vm?.mode && vm.mode !== 'hexagons') return false
    const dash = get<DashboardLike>('@diamondcoreprocessor.com/DashboardBee')
    if (dash?.isActive?.()) return false
    return true
  }

  // ── projection (a group's members + collision-resolved labels) ───────────

  /** A group's members, with deterministic labels and the label→{member,group}
   *  maps the click route reads. A duplicate label within the group is
   *  suffixed `Label (2)` so routing stays exact. */
  #members(id: string): GroupMember[] {
    this.#memberByLabel.clear()
    this.#groupByLabel.clear()
    const group = this.#registry.get(id)
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

  async #reconcileAndRepaint(id: string): Promise<void> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!history) return
    await this.#reconcile(history, id)
    // The lineage location is unchanged (still this group's page), so a bare
    // same-location navigate is swallowed by show-cell's fast-path skip. This
    // force-repaint signal makes show-cell drop its render cache and re-read
    // the new children (the launcher tiles mix in/out live). The navigate is
    // kept as a belt-and-braces nudge.
    EffectBus.emit('launcher:reconciled', { segments: this.#segsFor(id) })
    ;(nav?.replaceRaw ?? nav?.goRaw)?.(this.#segsFor(id))
  }

  /** Diff a group page's launcher cells against the group's members: keep
   *  existing in place (preserving arrangement), append new, drop removed.
   *  Commit LEAF-ONLY so the page is never linked into a parent — each group
   *  page is its own root lineage, a separate pool from the hive tree. */
  async #reconcile(history: HistoryLike, id: string): Promise<void> {
    // CURATED group (aggregation-layer model): the page layer's children ARE
    // the membership — enable/disableAggregation already committed them, so
    // reconciling from members() would be circular, and the cursor-forcing
    // below would snap a deliberately rewound menu back to head (undo/redo at
    // /<id> IS the group's curation history). Rebuild the label→member click-
    // routing maps (the only #reconcile side effect a curated group needs)
    // and leave the layer and the cursor alone.
    if (this.#registry.get(id)?.curated) {
      this.#members(id)
      return
    }
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const domain = lineage?.domain
    const members = this.#members(id)
    const segs = this.#segsFor(id)

    const bagLocSig = await history.sign({ domain, explorerSegments: () => segs })
    const layer = await history.currentLayerAt(bagLocSig).catch(() => null)
    const existing = await this.#childNames(history, layer)

    const wanted = members.map(m => m.label)
    const wantedSet = new Set(wanted)
    const kept = existing.filter(n => wantedSet.has(n))          // preserve order
    const fresh = wanted.filter(n => !existing.includes(n))      // append new
    // Clustered-island groups (help) demand a FIXED members() order so each
    // category's header tile interleaves directly ahead of its members; the
    // per-category islands are derived from that order downstream. Every other
    // group preserves the participant's arrangement (kept first, new appended).
    const ordered = !!this.#registry.get(id)?.orderedLayout
    const order = ordered ? wanted : [...kept, ...fresh]

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
    //    re-discovers it as a site.) Each child's bag is its own private
    //    lineage (no contention), so these child commits stay direct; the
    //    PARENT bag's children write below rides the LayerCommitter FIFO.
    // A CLUSTERED (orderedLayout / help) group carries per-tile role + group in
    // the payload, and BOTH header and action tiles need the group. Existing
    // action cells are "kept" (label unchanged), so writing only FRESH cells
    // would leave them without a group forever. So clustered groups (re)write
    // EVERY tile's decoration — self-migrating; content-addressed commitLayer
    // dedups the unchanged ones, so no history bloat and no re-index churn (we
    // only signal decorations:changed when the marker actually moved). Every
    // other group keeps the cheap fresh-only path (byte-identical payloads).
    const writtenMarker = new Map<string, string>()
    const toWrite = ordered ? order : fresh
    if (store?.putResource) {
      for (const name of toWrite) {
        const m = this.#memberByLabel.get(name)
        const shape = this.#groupByLabel.get(name)?.shape ?? ''
        const role = m?.role === 'header' ? 'header' : ''
        const group = m?.group ?? ''
        const childSegs = [...segs, name]
        try {
          const record = { kind: LAUNCH_KIND, appliesTo: [], payload: { segments: m?.segments ?? [], icon: m?.icon ?? '', label: name, shape, key: m?.key ?? '', ...(role ? { role } : {}), ...(group ? { group } : {}) } }
          const decoSig = await store.putResource(new Blob([JSON.stringify(record)], { type: 'application/json' }))
          const childLocSig = await history.sign({ domain, explorerSegments: () => childSegs })
          // Only clustered rewrites can hit an existing cell; read its prior head
          // so an unchanged decoration doesn't re-fire the index walk.
          const prior = ordered ? await history.latestMarkerSigFor(childLocSig, name).catch(() => '') : ''
          const marker = await history.commitLayer(childLocSig, { name, decorations: [decoSig] })
          if (marker && SIG.test(marker)) writtenMarker.set(name, marker)
          if (marker !== prior) EffectBus.emit('decorations:changed', { segments: childSegs, op: 'append', sig: decoSig })
        } catch { /* fall through to the marker read below */ }
      }
    }
    // 2. Resolve every child's marker sig. Written cells use the marker we just
    //    committed (deterministic — no empty-marker race); any not written reads
    //    its existing head IN PARALLEL. Promise.all preserves `order`, so
    //    arrangement is unchanged; empties filter out.
    const resolved = await Promise.all(order.map(async name => {
      const pre = writtenMarker.get(name)
      if (pre) return pre
      const childLocSig = await history.sign({ domain, explorerSegments: () => [...segs, name] })
      const childSig = await history.latestMarkerSigFor(childLocSig, name).catch(() => '')
      return childSig && SIG.test(childSig) ? childSig : ''
    }))
    const childSigs = resolved.filter(s => s !== '')

    // The bag's children write rides the LayerCommitter FIFO (commitSlotSet:
    // full-replace of the children slot with the sigs resolved above; name and
    // any other slots are preserved from the bag's head). A direct
    // history.commitLayer here was a read-modify-write OUTSIDE the FIFO —
    // interleaved with a committer commit on the same bag, last-marker-wins
    // silently dropped the other commit's child.
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.commitSlotSet) {
      console.warn('[mixed-group-bag] LayerCommitter unavailable — children not committed for', id)
      return
    }
    await committer.commitSlotSet(segs, 'children', childSigs)

    // Even through the committer, force the cursor to head for THIS bag: the
    // history cursor and the lineage layer memo may still lag the new head.
    // Left alone, re-showing while standing in the bag leaves the cursor one
    // marker behind head ("rewound"), and show-cell's rewound-render path
    // paints the PREVIOUS group's committed layer — the "switched group but
    // old content / looks hung" bug under rapid switches. Drop the lineage
    // memo and force the cursor to head for THIS bag so the next render reads
    // the freshly-committed children. (On a fresh icon-click entry the cursor is
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
