// hypercomb-shared/core/mixed-group-bag.ts
//
// MixedGroupBag — ONE shared positional aggregator that mixes the members of
// every ENABLED launch group into a single hexagon page. Replaces the old
// per-group GroupBag ("one-of": you were in zero or one aggregator at a time).
// Now the group meaning-icons are independent on/off toggles (state in
// GroupRegistry) and this bag shows the UNION of whatever is toggled on.
//
// Mirrors DashboardBee / the retired GroupBag: a real lineage bag you NAVIGATE
// INTO, so "current lineage location = where edits commit" makes arrangement
// persist. Committed LEAF-ONLY (its opaque segment is never linked into root's
// children) so it never appears as a stray tile and the website scan never
// reaches it.
//
// Cross-module contract: the opaque segment is `agg-mix`, under the shared
// `agg-` prefix. essentials/show-cell.drone.ts gives `agg-`-prefixed locations
// the launcher silhouette + drift, and tile-overlay.drone.ts routes a launcher
// tile click back as `group:open { label }`. Those modules MUST NOT import
// shared (CLAUDE.md), so the prefix is mirrored by string, never imported — a
// rename has to touch show-cell, tile-overlay, and this file together.
//
// The bag is constructed EAGERLY by GroupRegistry (not lazily on first toggle):
// its `group:open` listener and exit gestures must be live even after a refresh
// that reloads straight INTO `agg-mix`, otherwise the launcher tiles render but
// every click is a dead no-op. The listener rebuilds its routing maps on each
// click, so it routes correctly regardless of whether a toggle happened this
// session.
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
  /** Final (collision-resolved) cell label → its member / owning group. Rebuilt
   *  on every projection so a click routes to the right group's open(). */
  #memberByLabel = new Map<string, GroupMember>()
  #groupByLabel = new Map<string, LaunchGroup>()
  #suppressContextMenu = false
  /** Hive location of the site opened from the list this session, or null. */
  #lastOpenedSegments: string[] | null = null
  /** Serializes sync()/refresh so two rapid toggles can't both observe
   *  isActive()===false and double-enter (or strand the bag open after an
   *  on→off pair). */
  #syncing: Promise<void> = Promise.resolve()
  /** Last (enabled-set + member-label) signature already warmed by prewarm(), so
   *  the per-discovery-scan re-trigger is a cheap no-op once warm. */
  #prewarmedKey = ''
  /** True while the bag ITSELF flips ViewMode back to 'hexagons' as part of a
   *  group switch (#dismissActiveSurface). ViewMode dispatch is synchronous, so
   *  the flag brackets the setMode call and tells the surface-exit watchers
   *  (#wireModeReset + GroupRegistry.surfaceClosed via isSwitching()) that this
   *  transition is a SWITCH, not a user exit — without it the reset would wipe
   *  the group just tapped. */
  #suppressModeClear = false

  constructor(registry: GroupRegistry) {
    this.#registry = registry
    // Wire the exit gestures + click route EAGERLY (at construction, not on
    // first enter) so a refresh straight into `agg-mix` still routes clicks and
    // honours escape / right-click-to-exit. All handlers guard on isActive(),
    // so they're inert when the participant isn't standing in the mix.
    this.#wireGestures()
    // Every return to the hexagon canvas resets the launcher toggles, whatever
    // path the surface was opened or closed through (see #wireModeReset).
    this.#wireModeReset()

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
      // site lives so the bag's own exit() back-drills onto it. The FULL-exit
      // reset on surface close (launcher icons back to default, land on the
      // hive) is the STANDARD armed inside group.open() itself — every group
      // inherits it from LaunchGroupBase, so nothing group-specific is wired
      // here.
      if (member.segments.length > 0) this.#lastOpenedSegments = [...member.segments]
      group.open(member)
    })
  }

  /** True while the bag is dismissing a member surface as part of a group
   *  SWITCH. GroupRegistry.surfaceClosed (the standard launcher exit armed by
   *  LaunchGroupBase) consults this so a switch never reads as a user exit. */
  isSwitching(): boolean { return this.#suppressModeClear }

  /** True when the participant is currently inside the mixed bag. */
  isActive(): boolean {
    const segs = this.#currentSegments()
    return segs.length > 0 && segs[0] === this.#segments[0]
  }

  /** User toggled a group. Serialized so overlapping toggles resolve in order. */
  sync(): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#syncOnce()).catch(() => { /* keep the chain alive */ })
    return this.#syncing
  }

  /** A group's member set changed in the background (a site discovered, a game
   *  registered). Serialized with sync(); only ever updates IN PLACE — never
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
   *  strictly read-only (see #warmLineageHead: absent bag returns silently, NO
   *  minting). It never commits, never writes a decoration, never navigates, so
   *  the screen never moves (stillness rule). Serialized on #syncing so it can't
   *  race a real toggle; a toggle that lands mid-warm reconciles afterwards over
   *  a warm cache (and commitLayer dedups when nothing changed). */
  prewarm(): Promise<void> {
    this.#syncing = this.#syncing.then(() => this.#prewarmOnce()).catch(() => {})
    return this.#syncing
  }

  /** Warm a SPECIFIC group's aggregator on INTENT (icon hover) — even before it
   *  is enabled — so the FIRST click into it is fast, not just later ones. The
   *  agg-mix location is the same whatever group is enabled; only the launcher
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
   *  via currentLayerAt (mints nothing — see #warmLineageHead). Shared by the
   *  enabled-union prewarm and the per-group hover prewarm. Never commits /
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
    const enabled = this.#registry.enabledIds()
    if (enabled.length === 0) return        // nothing toggled on — no likely destination
    if (this.isActive()) return             // already inside — refreshIfActive owns it
    const members = this.#members()
    // Cheap idempotence: skip when this exact union is already warm. Discovery
    // re-fires notifyChanged on every scan; after the first warm these are
    // currentLayerAt cache hits anyway, but the key check avoids the OPFS dir
    // listings entirely.
    const key = enabled.join(',') + '|' + members.map(m => m.label).join('')
    if (key === this.#prewarmedKey) return

    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const domain = lineage?.domain

    // Warm the agg-mix head + every launcher child's head. currentLayerAt mints
    // nothing and populates #latestSigByLineage + the layer-byte caches, so the
    // real click's #reconcile (currentLayerAt + latestMarkerSigFor + getLayerBySig
    // per child) becomes cache hits and its commit dedups when unchanged.
    const bagLocSig = await history.sign({ domain, explorerSegments: () => this.#segments }).catch(() => '')
    if (!bagLocSig) return
    await history.currentLayerAt(bagLocSig).catch(() => null)
    await Promise.all(members.map(async m => {
      const childLocSig = await history
        .sign({ domain, explorerSegments: () => [...this.#segments, m.label] })
        .catch(() => '')
      if (childLocSig) await history.currentLayerAt(childLocSig).catch(() => null)
    }))

    this.#prewarmedKey = key
  }

  async #syncOnce(): Promise<void> {
    if (this.#registry.enabledIds().length === 0) {
      if (this.isActive()) this.exit()
      return
    }
    if (this.isActive()) { await this.#reconcileAndRepaint(); return }
    // Explicit user pick (an icon tap reaches sync()): leave any open member
    // surface — a render view (website/tutor) or the dashboard bag — and NAVIGATE
    // to the mixed page. (Background member-set changes go through refreshIfActive,
    // which never navigates, so they never reach here — so always entering on an
    // explicit pick is safe and is what the user expects: tap games → see games.)
    this.#dismissActiveSurface()
    await this.enter(true)
  }

  /** Leave a ViewMode render surface (website/tutor) so the mixed page is
   *  visible. The dashboard bag is hexagons-mode and is left by enter()'s goRaw,
   *  so only a ViewMode flip back to hexagons is needed here. The flip is
   *  bracketed by #suppressModeClear: it's a group SWITCH, not a user exit, so
   *  the hexagons-return watchers must not reset the toggle just selected. */
  #dismissActiveSurface(): void {
    const vm = get<ViewModeLike & { setMode?: (m: string) => void }>('@hypercomb.social/ViewMode')
    if (vm?.mode && vm.mode !== 'hexagons') {
      this.#suppressModeClear = true
      try { vm.setMode?.('hexagons') } finally { this.#suppressModeClear = false }
    }
  }

  async #refreshOnce(): Promise<void> {
    if (!this.isActive()) return
    if (this.#registry.enabledIds().length === 0) { this.exit(); return }
    await this.#reconcileAndRepaint()
  }

  /** Reconcile the bag to the live union, then navigate into it. `force` (an
   *  explicit icon tap) navigates even from another member surface — see
   *  #syncOnce; a background entry still defers via canEnter(). */
  async enter(force = false): Promise<void> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!history || !nav?.goRaw) {
      // Too early (HistoryService not registered yet) — retry once it's up,
      // routing through sync() so it re-consults enabledIds() at fire time
      // (the user may have toggled back off, or everything off, by then).
      const ioc = (window as unknown as { ioc?: IocLike }).ioc
      ioc?.whenReady?.('@diamondcoreprocessor.com/HistoryService', () => void this.sync())
      return
    }
    if (this.#registry.enabledIds().length === 0) return
    this.#lastOpenedSegments = null   // fresh session — nothing opened from the list yet

    // Don't capture a bag/dashboard segment as the return target — return to the
    // last REAL page so leaving the mix lands somewhere meaningful.
    const captureReturn = (): void => {
      const cur = this.#currentSegments()
      if (!(cur[0]?.startsWith('agg-') || cur[0]?.startsWith('dash-'))) this.#returnSegments = cur
    }

    if (force) {
      // Explicit pick (an icon tap) is a clean ONE-OF: RESET, then SELECT.
      // Reconcile the bag to the picked group's members FIRST — fully replacing
      // whatever the previous selection committed — THEN reset the render caches
      // and navigate. Committing before the navigate means the first paint at
      // agg-mix reads the NEW children; emitting `launcher:reconciled` before the
      // (synchronous) goRaw clears show-cell's cell cache so the landing render
      // can't serve the previous group's tiles. Net: switching groups never
      // flashes / sticks on the old content. (The background path below already
      // reconciles-before-navigate for the same reason.) The reconcile reads warm
      // caches after prewarm(), so the commit is cheap, not the old "stuck on the
      // old view" lag this used to guard against.
      captureReturn()
      await this.#reconcile(history)
      if (this.#registry.enabledIds().length === 0) { this.exit(); return }
      EffectBus.emit('launcher:reconciled', { segments: this.#segments })
      nav.goRaw(this.#segments)
      return
    }

    // Background entry: reconcile FIRST so we never navigate into an empty/stale
    // bag, and defer to canEnter() so a background scan can't yank the participant
    // off a surface.
    await this.#reconcile(history)
    if (this.#registry.enabledIds().length === 0 || !this.#canEnter()) return
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
   *  dashboard bag) — toggling a group from there must update in place, never
   *  eject the participant onto agg-mix. Games/help mount overlays that keep the
   *  lineage on agg-mix, so they read as active (the reconcile-in-place branch),
   *  not here. */
  #canEnter(): boolean {
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    if (vm?.mode && vm.mode !== 'hexagons') return false
    const dash = get<DashboardLike>('@diamondcoreprocessor.com/DashboardBee')
    if (dash?.isActive?.()) return false
    return true
  }

  // ── projection (the union + collision-resolved labels) ──────────────────

  /** Union of every enabled group's members, with deterministic labels and the
   *  label→{member,group} maps the click route reads. Iterates groups in
   *  registry insertion order (stable) with members sorted within each group
   *  (groups already sort); the FIRST occurrence of a label keeps it, a later
   *  same-label member from another group is suffixed `Label (GroupLabel)` so
   *  the rendered tile text stays human-readable and routing stays exact. */
  #members(): GroupMember[] {
    this.#memberByLabel.clear()
    this.#groupByLabel.clear()
    const out: GroupMember[] = []
    for (const id of this.#registry.enabledIds()) {
      const group = this.#registry.get(id)
      if (!group) continue
      for (const m of group.members()) {
        let label = m.label
        if (this.#memberByLabel.has(label)) {
          label = `${m.label} (${group.label})`
          // Pathological: two groups share BOTH the bare label and the suffix.
          let n = 2
          while (this.#memberByLabel.has(label)) label = `${m.label} (${group.label} ${n++})`
        }
        const member = label === m.label ? m : { ...m, label }
        this.#memberByLabel.set(label, member)
        this.#groupByLabel.set(label, group)
        out.push(member)
      }
    }
    return out
  }

  // ── reconcile ──────────────────────────────────────────────────────────

  async #reconcileAndRepaint(): Promise<void> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!history) return
    await this.#reconcile(history)
    // Emptied during the awaited reconcile (rapid toggle-off) — leave instead of
    // repainting an empty page.
    if (this.#registry.enabledIds().length === 0) { this.exit(); return }
    // The lineage location is unchanged (still agg-mix), so a bare same-location
    // navigate is swallowed by show-cell's fast-path skip. This force-repaint
    // signal makes show-cell drop its render cache and re-read the new children
    // (the launcher tiles mix in/out live). The navigate is kept as a belt-and-
    // braces nudge.
    EffectBus.emit('launcher:reconciled', { segments: this.#segments })
    ;(nav?.replaceRaw ?? nav?.goRaw)?.(this.#segments)
  }

  /** Diff the bag's launcher cells against the live union: keep existing in
   *  place (preserving arrangement), append new, drop removed. Commit LEAF-ONLY
   *  so the bag is never linked into a parent. */
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
          const record = { kind: LAUNCH_KIND, appliesTo: [], payload: { segments: m?.segments ?? [], icon: m?.icon ?? '', label: name, shape } }
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
    // a new head landed here. Left alone, re-toggling while standing in the bag
    // leaves the cursor one marker behind head ("rewound"), and show-cell's
    // rewound-render path paints the PREVIOUS group's committed layer — the
    // "switched group but old content / looks hung" bug under rapid toggles. Drop
    // the lineage memo and force the cursor to head for THIS bag so the next render
    // reads the freshly-committed children. (On a fresh icon-tap entry the cursor is
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

  // ── mode-reset safety net + helpers + exit gestures ────────────────────

  /** PERMANENT ViewMode watcher: ANY return to the hexagon canvas (exit-overlay
   *  click, the Escape safety net, the /website toggle) resets the launcher
   *  toggles to their default (nothing lit). The per-open reset is the STANDARD
   *  armed by LaunchGroupBase inside every group.open(); this watcher is the
   *  safety net for surfaces entered with NO group.open() at all (a typed
   *  /website over toggles that survived a reload) — without it the icon stays
   *  lit after the surface closes, and the next tap reads as "sole enabled →
   *  turn off" (selectExclusive), costing a second click to actually
   *  reactivate. Clearing here makes every reactivation a single click. Skipped while the bag itself
   *  dismisses a surface for a group switch (#suppressModeClear), and while the
   *  participant is still STANDING in the bag (a surface toggled over agg-mix —
   *  /website, /tutor — keeps the launcher session alive: clearing there would
   *  empty the bag and cascade into an unrequested exit navigation). Outside the
   *  bag clear() only syncs — enabledIds()===0 with isActive()===false is a
   *  no-op — so the screen stays where the participant is (stillness). */
  #wireModeReset(): void {
    const ioc = (window as unknown as { ioc?: IocLike }).ioc
    ioc?.whenReady?.('@hypercomb.social/ViewMode', (v) => {
      const vm = v as ViewModeLike
      if (!vm?.addEventListener) return
      let prev = vm.mode ?? 'hexagons'
      vm.addEventListener('change', () => {
        const next = vm.mode ?? 'hexagons'
        const leftSurface = prev !== 'hexagons' && next === 'hexagons'
        prev = next
        if (!leftSurface || this.#suppressModeClear || this.isActive()) return
        this.#registry.clear()
      })
    })
  }

  #currentSegments(): string[] {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** User-initiated exit gesture from the launch page (Escape / right-click):
   *  a FULL exit, uniform with closing a launched surface — reset the header
   *  launcher icons to their default FIRST (an icon left glowing after an
   *  explicit exit reads as still-active), then leave. exit() navigates
   *  synchronously; clear()'s queued sync then sees the bag inactive and
   *  stays put, so there is no double navigation. */
  #fullExit(): void {
    this.#registry.clear()
    this.exit()
  }

  #wireGestures(): void {
    // Escape (cascade last resort) closes the aggregator — icons reset too.
    EffectBus.on('global:escape', () => { if (this.isActive()) this.#fullExit() })
    // Right-click on the HEX-GRID canvas inside the aggregator = close. Capture
    // phase so it preempts tile-overlay's bubble-phase "up a level". Gated to the
    // Pixi host (#pixi-host) so a right-click inside a GAME overlay launched from
    // the mix (its own canvas, mounted elsewhere) reaches the game instead of
    // tearing the hive out from under it.
    document.addEventListener('pointerdown', this.#onPointerDownCapture, true)
    document.addEventListener('contextmenu', this.#onContextMenuCapture, true)
  }

  #onPointerDownCapture = (e: PointerEvent): void => {
    if (e.button !== 2) return
    if (!this.isActive()) return
    const t = e.target
    if (!(t instanceof HTMLElement) || !t.closest('#pixi-host')) return
    e.preventDefault()
    e.stopPropagation()
    this.#suppressContextMenu = true
    this.#fullExit()
  }

  #onContextMenuCapture = (e: MouseEvent): void => {
    if (!this.#suppressContextMenu) return
    this.#suppressContextMenu = false
    e.preventDefault()
    e.stopPropagation()
  }
}
