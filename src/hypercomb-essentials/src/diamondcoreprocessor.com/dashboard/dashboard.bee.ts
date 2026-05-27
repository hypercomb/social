// diamondcoreprocessor.com/dashboard/dashboard.bee.ts
//
// DashboardBee — the sole link between a location and its dashboard.
//
// Architecture (final form):
//
//   • Layer bytes stay PURE: `{ name, children: [], <shareable arrays> }`.
//     No `dashboards` slot. No `properties` slot. Properties live in the
//     0000 sidecar and travel via swarm, not via the merkle tree.
//
//   • A dashboard is a content-addressed bag at `__history__/<bagLocSig>/`.
//     Its bagLocSig is derived from a one-off segment string so the bag's
//     identity is unique but doesn't appear in any visible lineage. The
//     bag's layer markers (000x) hold `{ name, children: [<questionSig>] }`
//     — pure shareable shape, same rule as any other layer.
//
//   • The bee owns the registry: which locations have a pinned dashboard.
//     localStorage holds the cache; the canonical "this location is
//     pinned" event is gossiped on the lineage's mesh filter
//     (`hash(segments + location + secret)`). That filter is the existing
//     `history.sign(lineage)` primitive plus secret folding (TODO hook —
//     present as a marked seam below).
//
//   • Pill activation: bee subscribes to lineage change, looks up its own
//     map, emits/clears the pill via existing `indicator:set` /
//     `indicator:clear` EffectBus events. Indicator carries
//     `meta.kind: '@diamondcoreprocessor.com/dashboard'` so other domain
//     bees can publish their own pills under their own namespaces without
//     stepping on each other.
//
//   • Pill click → `indicator:open` (generic, dispatched by the
//     command-line for any action-pill) → bee filters by `meta.kind` →
//     navigates the canvas into the bag's segments → bag's children
//     render as real tiles → Q&A tile clicks fire `tile:action` →
//     DashboardQOpenWorker activates because the bee says "yes, this
//     location is one of mine".
//
//   • Removing the bee removes the dashboard surface entirely; the bag's
//     bytes remain in OPFS (recoverable by sig), and the layers it
//     references stay reachable from `__resources__/`. Bee = capability,
//     not data.

import { Worker, EffectBus } from '@hypercomb/core'

const STATE_KEY = 'hc:@diamondcoreprocessor.com/DashboardBee:bags'
const INDICATOR_KEY_PREFIX = '@diamondcoreprocessor.com/dashboard:'
const DASHBOARD_ICON = '◆'
const DASHBOARD_KIND = '@diamondcoreprocessor.com/dashboard'

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

type IndicatorOpenPayload = {
  key?: string
  sig?: string
  meta?: { kind?: string; segments?: readonly string[] }
}

/** What the bee persists per pinned dashboard. */
type PinnedBag = {
  /** locSig of the location this dashboard is pinned to (the "anchor"). */
  locationSig: string
  /** locSig of the dashboard's own bag at `__history__/<bagLocSig>/`. */
  bagLocSig: string
  /** Segments that hash to bagLocSig — preserved so we can navigate the
   *  canvas into the bag (URL → Lineage → locSig must match). */
  bagSegments: readonly string[]
}

export class DashboardBee extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'dashboard'

  public override description =
    'DashboardBee — provides dashboards as bag-backed views. Owns its bags internally; nothing in the layer tree references them.'

  protected override emits: string[] = ['indicator:set', 'indicator:clear']

  /** locationSig → PinnedBag. The cache of the swarm-gossiped pin set. */
  readonly #bags = new Map<string, PinnedBag>()

  /** Tracks which indicator keys the bee currently has on screen so a
   *  lineage change can clear stale ones cleanly. */
  readonly #activeIndicatorKeys = new Set<string>()

  protected override act = async (): Promise<void> => {
    this.#restoreState()
    this.#wireLineageSync()
    this.#wireOpenHandler()
    // First-paint sync. Without this, the pill wouldn't appear until the
    // first navigation event after boot.
    void this.#syncIndicatorsForCurrentLocation()
  }

  // ─── public API ─────────────────────────────────────────────────────

  /**
   * `/dashboard` invocation entry point. Mints a new bag, pins it to the
   * current location, emits the pill, returns the FULL pinned-bag entry
   * (locationSig, bagLocSig, bagSegments) so callers don't have to dig
   * through the bags map by index — there may be other entries from
   * prior pins at other locations.
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

    this.#emitIndicator(entry)
    return entry
  }

  /**
   * Gate for `DashboardQOpenWorker`. Returns true iff the user is
   * currently sitting INSIDE one of this bee's dashboard bags (i.e.
   * navigated to a bag via the pill). The worker uses this to decide
   * whether a tile-click should route to the Q&A modal.
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

  // ─── lineage sync ───────────────────────────────────────────────────

  #wireLineageSync(): void {
    const lineage = get<EventTarget>('@hypercomb.social/Lineage') as EventTarget | undefined
    if (!lineage?.addEventListener) return
    lineage.addEventListener('change', () => {
      void this.#syncIndicatorsForCurrentLocation()
    })
  }

  async #syncIndicatorsForCurrentLocation(): Promise<void> {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return

    // Clear the bee's previous indicators so old pills don't linger
    // when the user navigates to a location without a pinned bag.
    for (const key of this.#activeIndicatorKeys) {
      EffectBus.emit('indicator:clear', { key })
    }
    this.#activeIndicatorKeys.clear()

    const currentSegments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const currentLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => currentSegments,
    })

    // The pill appears in two cases:
    //   (a) The user is AT a location with a pinned bag — show the
    //       bag's pill, click opens the bag.
    //   (b) The user is INSIDE a bag — show the pill so the user knows
    //       they're inside a dashboard. (Future: distinguish visually.)
    const anchoredHere = this.#bags.get(currentLocSig)
    if (anchoredHere) {
      this.#emitIndicator(anchoredHere)
      return
    }
    for (const entry of this.#bags.values()) {
      if (entry.bagLocSig === currentLocSig) {
        this.#emitIndicator(entry)
        return
      }
    }
  }

  #emitIndicator(entry: PinnedBag): void {
    const key = INDICATOR_KEY_PREFIX + entry.locationSig
    this.#activeIndicatorKeys.add(key)
    EffectBus.emit('indicator:set', {
      key,
      icon: DASHBOARD_ICON,
      label: 'dashboard',
      dismissable: false,
      action: 'open',
      sig: entry.bagLocSig,
      // `meta` is how this bee distinguishes its pills from other domain
      // bees' pills. The command-line dispatch is generic; the bee
      // filters incoming `indicator:open` events by `meta.kind`.
      meta: { kind: DASHBOARD_KIND, segments: entry.bagSegments },
    })
  }

  // ─── open (navigate into the bag) ───────────────────────────────────

  #wireOpenHandler(): void {
    // Generic indicator-click dispatch. The command-line emits this for
    // ANY action pill; each domain bee subscribes and filters by kind.
    EffectBus.on<IndicatorOpenPayload>('indicator:open', (payload) => {
      if (payload?.meta?.kind !== DASHBOARD_KIND) return
      const segments = payload?.meta?.segments
      if (!Array.isArray(segments) || segments.length === 0) return
      this.#navigateInto(segments)
    })
  }

  #navigateInto(segments: readonly string[]): void {
    const nav = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!nav?.goRaw) return
    // goRaw preserves the segment chars verbatim — the locSig the
    // bag was minted at depends on the exact segment string.
    nav.goRaw(segments)
  }

  // ─── persistence + swarm (the registry surface) ─────────────────────

  #restoreState(): void {
    try {
      const raw = localStorage.getItem(STATE_KEY)
      if (!raw) return
      const list = JSON.parse(raw) as PinnedBag[]
      if (!Array.isArray(list)) return
      this.#bags.clear()
      for (const b of list) {
        if (!b?.locationSig || !b?.bagLocSig || !Array.isArray(b.bagSegments)) continue
        this.#bags.set(b.locationSig, {
          locationSig: b.locationSig,
          bagLocSig: b.bagLocSig,
          bagSegments: b.bagSegments,
        })
      }
    } catch { /* tolerate corrupt state */ }
  }

  #persistState(): void {
    const list: PinnedBag[] = [...this.#bags.values()]
    localStorage.setItem(STATE_KEY, JSON.stringify(list))
  }

  /**
   * Mesh-publish hook. The pin event should ride the lineage's filter
   * signature so it propagates to participants sharing the secret. The
   * filter sig is `hash(segments + location + secret)` — the existing
   * `history.sign(lineage)` primitive plus secret folding (which lives
   * in SecretStore + the swarm publish service).
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
