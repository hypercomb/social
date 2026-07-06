// diamondcoreprocessor.com/dashboard/dashboard.bee.ts
//
// DashboardBee — the sole link between a location and its dashboard, and
// the navigation-behavior controller behind the command-line dashboard
// toggle.
//
// Architecture (final form):
//
//   • Layer bytes stay PURE: `{ name, children: [], <shareable arrays> }`.
//     No `dashboards` slot. No `properties` slot. Properties live in the
//     0000 sidecar and travel via swarm, not via the merkle tree.
//
//   • A dashboard is a content-addressed lineage sigbag `<bagLocSig>/` at
//     the flat OPFS root (legacy `__history__/<bagLocSig>/` is a read-fallback).
//     Its bagLocSig is derived from a one-off segment string so the bag's
//     identity is unique but doesn't appear in any visible lineage. The
//     bag's layer markers (000x) hold `{ name, children: [<questionSig>] }`
//     — pure shareable shape, same rule as any other layer.
//
//   • The bee owns the registry: which locations have a pinned dashboard.
//     localStorage holds the cache; the canonical "this location is
//     pinned" event is gossiped on the lineage's mesh filter (TODO hook —
//     present as a marked seam below).
//
//   • SURFACE = a ViewBehavior TOGGLE, not a status pill. The bee registers
//     a `behavior: 'navigation'` descriptor with VisualBeeRegistry; ViewBee
//     (commands/view.bee.ts) is the sole producer of `view-toggles:changed`
//     and surfaces this bee's toggle on the right side of the command line
//     — same family as `/website`. ViewBee delegates the toggle's
//     availability / active-state / click to the controller methods below
//     (`isAvailable`, `isActive`, `toggleBehavior`). The bee emits
//     `dashboard:state` whenever a dashboard is minted / opened / closed so
//     ViewBee re-surfaces the toggle immediately.
//
//   • Open  = navigate the canvas into the bag's segments (remembering where
//     we came from). Close = navigate back to that exact prior location.
//     Three gestures close it: re-clicking the toggle, Escape (the
//     escape-cascade's `global:escape` fallback), and right-click on the
//     canvas (intercepted in capture phase so it doesn't fall through to the
//     overlay's default up-a-level back-nav).
//
//   • Removing the bee removes the dashboard surface entirely; the bag's
//     bytes remain in OPFS (recoverable by sig), and the layers it
//     references stay reachable as content at the flat OPFS root (legacy
//     `__resources__/` is a read-fallback). Bee = capability,
//     not data.

import { Worker, EffectBus } from '@hypercomb/core'

const STATE_KEY = 'hc:@diamondcoreprocessor.com/DashboardBee:bags'
const RETURN_KEY = 'hc:@diamondcoreprocessor.com/DashboardBee:return'

type LineageLike = {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}

type LayerContent = { name?: string; children?: string[]; [slot: string]: unknown }

type HistoryServiceLike = {
  sign(l: LineageLike): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerContent | null>
  commitLayer(locationSig: string, layer: LayerContent): Promise<string>
  getLayerBySig(sig: string): Promise<LayerContent | null>
}

type NavigationLike = {
  goRaw: (segments: readonly string[]) => void
}

/** What the bee persists per pinned dashboard. */
type PinnedBag = {
  /** locSig of the location this dashboard is pinned to (the "anchor"). */
  locationSig: string
  /** locSig of the dashboard's own lineage sigbag `<bagLocSig>/` (at the
   *  flat OPFS root; legacy `__history__/<bagLocSig>/` is a read-fallback). */
  bagLocSig: string
  /** Segments that hash to bagLocSig — preserved so we can navigate the
   *  canvas into the bag (URL → Lineage → locSig must match). */
  bagSegments: readonly string[]
}

export class DashboardBee extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'dashboard'

  public override description =
    'DashboardBee — provides the dashboard as a navigation-behavior toggle. Owns its bag internally; nothing in the layer tree references it.'

  protected override emits: string[] = ['dashboard:state']

  /** locationSig → PinnedBag. The cache of the swarm-gossiped pin set. */
  readonly #bags = new Map<string, PinnedBag>()

  /** Where the participant was when they opened the dashboard. Closing
   *  (toggle / Escape / right-click) returns here exactly. Persisted so a
   *  reload while inside the dashboard still has a sane return target. */
  #returnSegments: readonly string[] | null = null

  /** Set on the pointerdown that closed the dashboard so the trailing
   *  native contextmenu is swallowed (the close already happened). */
  #suppressContextMenu = false

  protected override act = async (): Promise<void> => {
    this.#restoreState()
    this.#wireEscape()
    this.#wireRightClick()
    // First-paint surface. If a dashboard was restored from a prior session,
    // this nudges ViewBee to show the toggle without waiting for a nav event.
    EffectBus.emit('dashboard:state', {})
  }

  // ─── public API ─────────────────────────────────────────────────────

  /**
   * `/dashboard` invocation entry point. Mints a new bag, pins it to the
   * current location, surfaces the toggle, and returns the FULL pinned-bag
   * entry (locationSig, bagLocSig, bagSegments). Does NOT navigate — the
   * toggle icon opens the dashboard, the command only ensures it exists.
   */
  public async createDashboardForCurrentLocation(): Promise<PinnedBag | null> {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return null

    const currentSegments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const currentLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => currentSegments,
    })

    // Single-instance invariant: at most ONE dashboard exists across the
    // whole hive — it is the single place every Claude question aggregates
    // to be answered. If one already exists, RE-ANCHOR that same bag to the
    // current location (preserving the questions it already holds) instead
    // of minting a second.
    const existing = this.#currentBag()
    if (existing) {
      this.#bags.clear()
      const reanchored: PinnedBag = {
        locationSig: currentLocSig,
        bagLocSig: existing.bagLocSig,
        bagSegments: existing.bagSegments,
      }
      this.#bags.set(currentLocSig, reanchored)
      this.#persistState()
      this.#publishToSwarm(reanchored)
      EffectBus.emit('dashboard:state', {})
      return reanchored
    }

    // The bag lives at a unique single-segment lineage. The segment
    // encodes (location-prefix, salt) — the location prefix keeps the
    // bag mentally tied to its anchor, the salt makes it unique. The
    // segment is opaque to renderers (no layer's `children` ever
    // references it), so it never appears as a tile anywhere.
    const salt = Date.now().toString(36)
    const bagSegments = [`dash-${currentLocSig.slice(0, 8)}-${salt}`]
    const bagLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => bagSegments,
    })

    // Mint the empty dashboard layer at the bag's locSig. commitLayer
    // is leaf-only — no cascade, no parent layer updated, no pollution.
    // The layer's bytes carry ONLY shareable canonical state.
    await history.commitLayer(bagLocSig, {
      name: bagSegments[0],
      children: [],
    })

    const entry: PinnedBag = { locationSig: currentLocSig, bagLocSig, bagSegments }
    this.#bags.set(currentLocSig, entry)
    this.#persistState()
    this.#publishToSwarm(entry)

    EffectBus.emit('dashboard:state', {})
    return entry
  }

  // ─── navigation-behavior controller (consumed by ViewBee) ───────────

  /** A dashboard exists → the toggle should be offered. */
  public isAvailable(): boolean {
    return this.#bags.size > 0
  }

  /** The participant is currently inside the dashboard bag (or its
   *  subtree). Sync — compares the current lineage's first segment to the
   *  bag's unique root segment. */
  public isActive(): boolean {
    const bag = this.#currentBag()
    if (!bag || !bag.bagSegments.length) return false
    const segs = this.#currentSegments()
    return segs.length > 0 && segs[0] === bag.bagSegments[0]
  }

  /** Toggle the dashboard: open if outside, close (back to previous) if
   *  inside. The single action ViewBee dispatches on a toggle click. */
  public toggleBehavior(): void {
    if (this.isActive()) this.#closeDashboard()
    else this.#openDashboard()
  }

  /**
   * Gate for `DashboardQOpenWorker`. Returns true iff the user is
   * currently sitting INSIDE one of this bee's dashboard bags.
   */
  public isLocationADashboard(locationSig: string): boolean {
    for (const entry of this.#bags.values()) {
      if (entry.bagLocSig === locationSig) return true
    }
    return false
  }

  /**
   * For diagnostics / swarm replay / external introspection. Returns a
   * snapshot of the pinned bags so callers can inspect or restore.
   */
  public listPinnedBags(): readonly PinnedBag[] {
    return [...this.#bags.values()]
  }

  // ─── open / close ───────────────────────────────────────────────────

  /** Navigate the canvas into the bag, remembering where we came from. */
  #openDashboard(): void {
    const bag = this.#currentBag()
    if (!bag) return
    this.#returnSegments = this.#currentSegments()
    this.#persistReturn()
    this.#navigateInto(bag.bagSegments)
    EffectBus.emit('dashboard:state', {})
  }

  /** Navigate back to the exact location the dashboard was opened from. */
  #closeDashboard(): void {
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    nav?.goRaw?.(this.#returnSegments ?? [])
    EffectBus.emit('dashboard:state', {})
  }

  #navigateInto(segments: readonly string[]): void {
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!nav?.goRaw) return
    // goRaw preserves the segment chars verbatim — the locSig the
    // bag was minted at depends on the exact segment string.
    nav.goRaw(segments)
  }

  // ─── close gestures: Escape + right-click ───────────────────────────

  /** Escape closes the dashboard — but only as the cascade's last resort
   *  (`global:escape`), so open editors / modals / selections clear first. */
  #wireEscape(): void {
    EffectBus.on('global:escape', () => {
      if (this.isActive()) this.#closeDashboard()
    })
  }

  /** Right-click on the canvas while inside the dashboard = close (back to
   *  previous). Capture phase so it preempts the tile-overlay's bubble-phase
   *  pointerdown handler, whose default is "up a level". */
  #wireRightClick(): void {
    document.addEventListener('pointerdown', this.#onPointerDownCapture, true)
    document.addEventListener('contextmenu', this.#onContextMenuCapture, true)
  }

  #onPointerDownCapture = (e: PointerEvent): void => {
    if (e.button !== 2) return
    if (!this.isActive()) return
    if (!(e.target instanceof HTMLCanvasElement)) return
    e.preventDefault()
    e.stopPropagation()
    this.#suppressContextMenu = true
    this.#closeDashboard()
  }

  #onContextMenuCapture = (e: MouseEvent): void => {
    if (!this.#suppressContextMenu) return
    this.#suppressContextMenu = false
    e.preventDefault()
    e.stopPropagation()
  }

  // ─── helpers ────────────────────────────────────────────────────────

  #currentSegments(): string[] {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** The single dashboard entry, if one exists. The bee holds at most one
   *  (single-instance invariant); this is the canonical accessor. */
  #currentBag(): PinnedBag | undefined {
    return this.#bags.values().next().value as PinnedBag | undefined
  }

  // ─── persistence + swarm (the registry surface) ─────────────────────

  #restoreState(): void {
    try {
      const raw = localStorage.getItem(STATE_KEY)
      if (raw) {
        const list = JSON.parse(raw) as PinnedBag[]
        if (Array.isArray(list)) {
          this.#bags.clear()
          for (const b of list) {
            if (!b?.locationSig || !b?.bagLocSig || !Array.isArray(b.bagSegments)) continue
            this.#bags.set(b.locationSig, {
              locationSig: b.locationSig,
              bagLocSig: b.bagLocSig,
              bagSegments: b.bagSegments,
            })
            // Single-instance: collapse any legacy multi-bag state to the
            // first valid entry. The others remain recoverable by sig in OPFS.
            break
          }
          // Rewrite storage so a legacy multi-bag list is permanently collapsed.
          this.#persistState()
        }
      }
    } catch { /* tolerate corrupt state */ }

    try {
      const rawRet = localStorage.getItem(RETURN_KEY)
      if (rawRet) {
        const arr = JSON.parse(rawRet) as unknown[]
        if (Array.isArray(arr)) this.#returnSegments = arr.map(s => String(s))
      }
    } catch { /* tolerate corrupt state */ }
  }

  #persistState(): void {
    const list: PinnedBag[] = [...this.#bags.values()]
    localStorage.setItem(STATE_KEY, JSON.stringify(list))
  }

  #persistReturn(): void {
    try {
      if (this.#returnSegments) localStorage.setItem(RETURN_KEY, JSON.stringify(this.#returnSegments))
      else localStorage.removeItem(RETURN_KEY)
    } catch { /* ignore */ }
  }

  /**
   * Mesh-publish hook. The pin event should ride the lineage's filter
   * signature so it propagates to participants sharing the secret.
   *
   * Marked TODO because the swarm publish API needs a small bit of
   * triage to wire to from a Worker — the existing properties-publish
   * path is the model.
   */
  #publishToSwarm(_entry: PinnedBag): void {
    // TODO: swarm.publish({ filter: lineageFilterSig, kind: 'dashboard-pinned', bag: _entry })
    // For now, localStorage-only. Pins are visible only on the
    // participant that created them until the swarm hook lands.
  }
}

// ── registration ────────────────────────────────────────

const _dashboardBee = new DashboardBee()
window.ioc.register('@diamondcoreprocessor.com/DashboardBee', _dashboardBee)

// The dashboard NO LONGER registers a VisualBeeRegistry view-toggle. It now
// surfaces solely as a launch-group icon (hypercomb-shared/core/dashboard-group),
// whose click calls this bee's toggleBehavior() — so the old ViewBee command-line
// toggle was a duplicate of that icon and has been retired (dedupe). The bee
// remains the dashboard's navigation controller (isAvailable/isActive/
// toggleBehavior); only the redundant toggle surfacing is gone.
