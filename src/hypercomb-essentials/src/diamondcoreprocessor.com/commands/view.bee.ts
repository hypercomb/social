// diamondcoreprocessor.com/commands/view.bee.ts
//
// ViewBee — surfaces the available "view behaviors" for the current node as
// toggleable icons on the right side of the command line, and flips the
// GLOBAL render surface when one is toggled.
//
// A view behavior (see VisualBeeRegistry) is an alternate rendering of the
// tree — e.g. `/website` renders cells as HTML pages instead of the hex
// grid. The render surface is a SINGLE GLOBAL flag (ViewModeService): one
// `/website on` turns websites on everywhere there's a page, one `/website
// off` turns them off, bare `/website` toggles. There is no per-branch
// marker state any more — websites are a global view, and WHICH cells
// actually have a page is decided entirely by the `visual:website:page`
// decorations the build pass writes (independent, signature-addressed,
// undoable resources living on each cell's own layer — no central map, no
// cross-cell dependency).
//
// The command-line toggle is SCOPE-BOUND: it appears on a cell that HAS a
// page of the view's kind (a `visual:website:page` decoration or a
// first-class `website` slot), and — for the website view — anywhere INSIDE
// that site's hierarchy (a website is an APPLICATION SCOPE declared at its
// root; descendants are members without stamping). It is deliberately NOT
// global presence: one page somewhere must not light the toggle everywhere.
// Standing on the PARENT of a site root — the page where the site's tile
// merely sits as a child — is OUTSIDE the scope: no toggle. Clicking it
// flips the global ViewMode; its active state mirrors the flag. The site
// root's decoration payload supplies the toggle glyph/label so every site
// keeps its distinct icon.
//
// `/website here` (handled in website.queen.ts) is a SEPARATE gesture: it
// drops a `visual:website:pending` decoration on the current cell for the
// NEXT gen pass to pick up. That marker is build-intent, not a render
// surface — it never flips ViewMode and is not what lights this toggle.
//
// Registry-owned, lineage-driven, emits over EffectBus
// (`view-toggles:changed`), handles clicks via `view:toggle`.

import { Worker, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { VisualBeeRegistry, VisualBeeDescriptor } from './visual-bee-registry.js'
import { WEBSITE_SLOT } from './website-slot.js'
import { isFeatureHidden, isFeatureHiddenWithin } from '../sharing/feature-hidden.js'

const SIG_RE = /^[0-9a-f]{64}$/
/** Fallback glyph when a view forgets to declare a Material toggleIcon. */
const FALLBACK_TOGGLE_ICON = 'visibility'
/** The render surface websites toggle against. */
const DEFAULT_SURFACE = 'hexagons'

type LineageLike = EventTarget & {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}
type ViewModeLike = EventTarget & {
  mode: string
  is(name: string): boolean
  setMode(next: string): void
  toggle(a?: string, b?: string): string
}
type LayerLike = { decorations?: unknown; context?: unknown; [k: string]: unknown }
/** A parsed decoration record from a cell's `decorations` slot. `payload`
 *  is the bee-specific bag — for the website bee it carries `htmlSig` (the
 *  generated page, read by SiteViewDrone) and optionally `icon` / `label`
 *  (this website's distinct toggle glyph + tooltip, read here). */
type DecorationRecord = { kind: string; payload?: Record<string, unknown> }
type HistoryServiceLike = {
  sign(l: { domain?: () => string; explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
}
type HistoryCursorLike = { currentLayerSig?: string; state?: { locationSig?: string } }
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type RegistryLike = Pick<VisualBeeRegistry, 'all' | 'get'>

/** A `behavior: 'navigation'` view's controller.
 *  ViewBee resolves it via the descriptor's `controllerKey` and delegates
 *  the toggle's availability, active-state, and click action — instead of
 *  the global-ViewMode flip used for `render` behaviors. */
type NavigationController = {
  isAvailable(): boolean
  isActive(): boolean
  toggleBehavior(): void
}

export type ViewToggle = {
  readonly view: string
  readonly icon: string
  readonly label: string
  readonly active: boolean
}

export class ViewBee extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'view'

  public override description =
    'ViewBee — surfaces available view behaviors (e.g. website) as command-line toggles and flips the global render surface.'

  protected override emits: string[] = ['view-toggles:changed']

  /** Microtask coalescing — a single navigation fires several triggers
   *  (lineage change + render:cell-count + decorations:changed); collapse
   *  them into one async recompute per tick. */
  #pending = false

  protected override act = async (): Promise<void> => {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    lineage?.addEventListener?.('change', () => this.#schedule())

    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    vm?.addEventListener?.('change', () => {
      this.#schedule()
      void this.#enforceActiveViewEnabled()
    })

    // Decoration hydration + live decoration mutations can change which
    // views are available — recompute on both. (When the build skill writes
    // pages, `decorations:changed` populates the kind index, and this makes
    // the toggle appear without a navigation.)
    EffectBus.on('render:cell-count', () => this.#schedule())
    EffectBus.on('decorations:changed', () => this.#schedule())

    // The cursor rebinding to a new location (or the user rewinding) changes
    // which layer "here" resolves to. Without this, a navigation whose
    // cursor.load() finished after our last recompute left the PREVIOUS
    // node's toggles (the website icon) stuck on the new page.
    EffectBus.on('history:cursor-changed', () => this.#schedule())

    // One activation choke point for every render view. The Beehaviors and
    // Views panels both publish `feature:hidden` at the gesture boundary; if
    // that behavior owns the current global surface, release it immediately.
    // Renderers still keep their hidden gate as defense-in-depth, but none of
    // them has to invent its own "off means hexagons" transition.
    EffectBus.on<{ view?: string; featKind?: string }>('feature:hidden', (payload) => {
      const vmNow = get<ViewModeLike>('@hypercomb.social/ViewMode')
      if (!vmNow || vmNow.mode === DEFAULT_SURFACE) { this.#schedule(); return }
      const registry = get<RegistryLike>('@diamondcoreprocessor.com/VisualBeeRegistry')
      const descriptor = registry?.get?.(vmNow.mode)
      const ownsSurface = payload?.view === vmNow.mode ||
        (!!payload?.featKind && descriptor?.decorationKind === payload.featKind)
      if (ownsSurface) vmNow.setMode(DEFAULT_SURFACE)
      this.#schedule()
    })
    EffectBus.on('feature:restored', () => this.#schedule())

    // Command-line click and the `/website` slash command both arrive here.
    // A `navigation` behavior delegates to its controller (open/close a
    // lineage); a `render` behavior flips the GLOBAL ViewMode directly. There
    // is no marker round-trip any more — the surface is one global flag, so
    // `setMode` sticks (no recompute reverts it).
    //
    //   plain click / bare `/website`        → mode 'toggle': flip hex ⇄ view
    //   `/website on`                         → mode 'on': force the view on
    //   cmd|long-press click / `/website off` → off / disable: back to hexagons
    EffectBus.on<{ view?: string; mode?: 'on' | 'off' | 'toggle'; disable?: boolean }>('view:toggle', ({ view, mode, disable }) => {
      if (!view) return
      const registry = get<RegistryLike>('@diamondcoreprocessor.com/VisualBeeRegistry')
      const desc = registry?.get?.(view)
      if (desc?.behavior === 'navigation') {
        const controller = desc.controllerKey ? get<NavigationController>(desc.controllerKey) : undefined
        controller?.toggleBehavior?.()
        return
      }
      const vmNow = get<ViewModeLike>('@hypercomb.social/ViewMode')
      if (!vmNow) return
      if (disable || mode === 'off') vmNow.setMode(DEFAULT_SURFACE)
      else if (mode === 'on') vmNow.setMode(view)
      else vmNow.toggle(DEFAULT_SURFACE, view)
      this.#schedule()
    })

    // First paint — without this the toggles wouldn't appear until the
    // first navigation/render event after boot.
    this.#schedule()
  }

  /** Final generic gate for every render view, including older renderers that
   *  do not yet import feature-hidden themselves. Direct slash commands can
   *  set ViewMode without going through a tile icon; validate that transition
   *  against the same hidden substrate before allowing the surface to remain.
   */
  async #enforceActiveViewEnabled(): Promise<void> {
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    if (!vm || vm.mode === DEFAULT_SURFACE) return
    const descriptor = get<RegistryLike>('@diamondcoreprocessor.com/VisualBeeRegistry')?.get?.(vm.mode)
    if (!descriptor?.decorationKind || descriptor.behavior === 'navigation') return
    const segments = (get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const branchScoped = descriptor.scope === 'branch' || !!descriptor.cascades
    const hidden = await (branchScoped
      ? isFeatureHiddenWithin(segments, descriptor.decorationKind)
      : isFeatureHidden(segments, descriptor.decorationKind)).catch(() => false)
    if (hidden && vm.mode === descriptor.view) vm.setMode(DEFAULT_SURFACE)
  }

  #schedule(): void {
    if (this.#pending) return
    this.#pending = true
    queueMicrotask(() => {
      this.#pending = false
      void this.#recompute()
    })
  }

  async #recompute(): Promise<void> {
    const registry = get<RegistryLike>('@diamondcoreprocessor.com/VisualBeeRegistry')
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    const views = (registry?.all?.() ?? []) as VisualBeeDescriptor[]
    if (!views.length || !vm) { this.#emit([]); return }

    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const layer = await this.#currentNodeLayer(segments)
    const records = await this.#decorationRecords(layer)

    const toggles: ViewToggle[] = []
    for (const v of views) {
      if (!v?.view) continue

      // Views launched from the launch-group aggregator (website) opt out of
      // the per-node command-line toggle — the launcher owns opening them, so
      // a second button beside the launcher icons is redundant. Their slash
      // command still routes through `view:toggle` above.
      if (v.commandLineToggle === false) continue

      // Navigation behaviors are not render surfaces —
      // availability and active-state come from a controller bee, and the
      // toggle navigates rather than switching ViewMode. Delegate and skip
      // the decoration/ViewMode machinery entirely.
      if (v.behavior === 'navigation') {
        const controller = v.controllerKey ? get<NavigationController>(v.controllerKey) : undefined
        if (!controller?.isAvailable?.()) continue
        toggles.push({
          view: v.view,
          icon: v.toggleIcon || FALLBACK_TOGGLE_ICON,
          label: this.#label(v),
          active: !!controller.isActive?.(),
        })
        continue
      }

      // Render behavior. The toggle is PER-NODE: surface it only when THIS
      // cell actually carries the view's content, so flipping the global
      // surface always mounts something (never a blank "empty view" screen).
      // The `/website`-style slash command stays the escape hatch to turn the
      // global view off from anywhere. A cell "has" the content via either:
      //   • a FIRST-CLASS SLOT (v.slot) holding a non-empty signature array —
      //     the doctrine-pure home (tutor's deck items live here), OR
      //   • a `visual:*:page`-style decoration of v.decorationKind — the
      //     legacy/website path, which also supplies a per-instance icon/label.
      let present = false
      let payloadIcon = ''
      let payloadLabel = ''

      if (v.slot) {
        const slotVal = layer ? (layer as Record<string, unknown>)[v.slot] : undefined
        if (Array.isArray(slotVal) && slotVal.some(s => typeof s === 'string' && SIG_RE.test(s))) present = true
      }
      if (!present && v.decorationKind) {
        const record = records.find(r => r.kind === v.decorationKind)
        if (record) {
          present = true
          // This cell's own decoration payload supplies its distinct icon /
          // label tooltip (every website keeps its own glyph). Falls back to
          // the view's static `toggleIcon`, then the generic glyph.
          const payload = record.payload
          payloadIcon = typeof payload?.['icon'] === 'string' ? (payload['icon'] as string).trim() : ''
          payloadLabel = typeof payload?.['label'] === 'string' ? (payload['label'] as string).trim() : ''
        }
      }

      // Slot-only page on THIS node — the website bee declares no descriptor
      // `slot`; its first-class home is the `website` layer slot, so the
      // generic check above can't see it.
      if (!present && v.view === 'website' && this.#hasWebsiteSlot(layer)) present = true

      // BRANCH SCOPE — an APPLICATION SCOPE declared at its root; descendants
      // are members WITHOUT stamping (a website's pages; a tree-scoped
      // branch). When this node carries nothing of its own, walk the lineage
      // outermost-first: the first ancestor carrying the feature is the scope
      // root, and being under it makes the view available here. The walk
      // probes only STRICT prefixes of the current path, so standing on the
      // PARENT of a scope root (where it merely sits as a child) never
      // matches — step outside the hierarchy and the toggle drops.
      //
      // The same walk serves ATTACHED views whose declaration chose
      // `sourceScope: 'hierarchy'` (brief, atlas, studio): a view applied to
      // a hierarchy applies all the way down it, one layer at a time, so
      // every descendant must be OFFERED the icon to use it. A layer-scoped
      // declaration stays node-local — the walk only honors records whose
      // payload says hierarchy.
      let hierarchyMember = false
      const walkable = v.scope === 'branch' ||
        (v.sourceScopes?.includes('hierarchy') ?? false)
      if (!present && walkable && segments.length > 1) {
        const root = await this.#branchScopeRoot(segments, v)
        if (root) {
          present = true
          hierarchyMember = v.scope !== 'branch'
          const record = v.decorationKind ? root.records.find(r => r.kind === v.decorationKind) : undefined
          const payload = record?.payload
          payloadIcon = typeof payload?.['icon'] === 'string' ? (payload['icon'] as string).trim() : ''
          payloadLabel = typeof payload?.['label'] === 'string' ? (payload['label'] as string).trim() : ''
        }
      }
      if (!present) continue

      // HIDDEN-POOL GATE — the participant's "set to show" switch, applied to
      // EVERY view, not just websites: never offer an entrance to a view its
      // drone will then refuse to mount. Reach matches each drone's own gate —
      // a scope feature (a website) hides by BRANCH, so a record at the site
      // root silences the whole site and a mid-branch record just that branch;
      // a node-local view (home, slides, tutor) hides exactly where the record
      // sits.
      if (v.decorationKind) {
        const branchScoped = v.scope === 'branch' || !!v.cascades || hierarchyMember
        const hidden = await (branchScoped
          ? isFeatureHiddenWithin(segments, v.decorationKind)
          : isFeatureHidden(segments, v.decorationKind)).catch(() => false)
        if (hidden) continue
      }

      toggles.push({
        view: v.view,
        icon: payloadIcon || v.toggleIcon || FALLBACK_TOGGLE_ICON,
        label: payloadLabel || this.#label(v),
        active: vm.is(v.view),
      })
    }
    this.#emit(toggles)
  }

  /** The toggle's human label — its tooltip and aria-label. The view's
   *  `labelKey` through i18n ("Website", "Slides", "Study"), falling back to
   *  the raw view id when a catalog is missing the key (t() echoes the key
   *  back, so guard on that). A cell's own decoration payload label still
   *  wins over this — every website names itself. */
  #label(v: VisualBeeDescriptor): string {
    if (!v.labelKey) return v.view
    const translated = get<I18nProvider>(I18N_IOC_KEY)?.t(v.labelKey)
    return translated && translated !== v.labelKey ? translated : v.view
  }

  /** The node the user is currently sitting on. Signs the current path and
   *  reads its head layer. The warm cursor layer sig is used ONLY when the
   *  cursor is bound to THIS location — during a navigation the cursor still
   *  points at the PREVIOUS location's head until its async load() completes,
   *  and trusting it blindly left the old node's toggles (the website icon)
   *  stuck on the new page. */
  async #currentNodeLayer(segments: readonly string[]): Promise<LayerLike | null> {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => [...segments] }).catch(() => null)
    const cursor = get<HistoryCursorLike>('@diamondcoreprocessor.com/HistoryCursorService')
    const cursorSig = cursor?.currentLayerSig
    if (cursorSig && SIG_RE.test(cursorSig) && locSig && cursor?.state?.locationSig === locSig) {
      const layer = await history.getLayerBySig(cursorSig).catch(() => null)
      if (layer) return layer
    }
    if (!locSig) return null
    return history.currentLayerAt(locSig).catch(() => null)
  }

  /** Non-empty first-class `website` slot on a layer — a slot-only page. */
  #hasWebsiteSlot(layer: LayerLike | null): boolean {
    const slot = layer ? (layer as Record<string, unknown>)[WEBSITE_SLOT] : undefined
    return Array.isArray(slot) && slot.some(s => typeof s === 'string' && SIG_RE.test(s))
  }

  /** Outermost-first ancestor walk for an APPLICATION SCOPE. Returns the
   *  scope root's layer + parsed decoration records when the current node
   *  sits INSIDE the hierarchy, null otherwise. Probes only strict prefixes
   *  of the path, so the parent of a scope root never matches. Mirrors
   *  ShowFeaturesDrone's scope pass.
   *
   *  A `scope: 'branch'` descriptor roots the same three ways a node
   *  presents: the descriptor's first-class `slot`, the website slot (the
   *  one bee whose slot the descriptor can't name), or a `decorationKind`
   *  record. A node-scoped descriptor with `sourceScopes` roots ONLY via a
   *  `decorationKind` record whose payload chose `sourceScope: 'hierarchy'`
   *  — the attachment gesture that says "apply this view all the way down,
   *  one layer at a time"; a layer-scoped attachment never cascades. */
  async #branchScopeRoot(
    segments: readonly string[],
    v: VisualBeeDescriptor,
  ): Promise<{ layer: LayerLike; records: DecorationRecord[] } | null> {
    const branch = v.scope === 'branch'
    for (let d = 1; d < segments.length; d++) {
      const layer = await this.#layerAtSegments(segments.slice(0, d))
      if (!layer) continue
      if (branch && v.slot) {
        const slotVal = (layer as Record<string, unknown>)[v.slot]
        if (Array.isArray(slotVal) && slotVal.some(s => typeof s === 'string' && SIG_RE.test(s))) {
          return { layer, records: await this.#decorationRecords(layer) }
        }
      }
      if (branch && v.view === 'website' && this.#hasWebsiteSlot(layer)) {
        return { layer, records: await this.#decorationRecords(layer) }
      }
      if (v.decorationKind) {
        const records = await this.#decorationRecords(layer)
        const record = records.find(r => r.kind === v.decorationKind)
        if (record && (branch || record.payload?.['sourceScope'] === 'hierarchy')) {
          return { layer, records }
        }
      }
    }
    return null
  }

  /** Head layer at an arbitrary location (sign the path → current layer). */
  async #layerAtSegments(segments: readonly string[]): Promise<LayerLike | null> {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => [...segments] }).catch(() => null)
    if (!locSig) return null
    return history.currentLayerAt(locSig).catch(() => null)
  }

  /** Parsed decoration records on the layer's `decorations` slot. Used here
   *  only for the per-view payload (the website's `icon` / `label`) when the
   *  user is standing on a decorated cell. */
  async #decorationRecords(layer: LayerLike | null): Promise<DecorationRecord[]> {
    const out: DecorationRecord[] = []
    const decorations = Array.isArray(layer?.decorations) ? layer!.decorations as unknown[] : []
    if (!decorations.length) return out
    const store = get<StoreLike>('@hypercomb.social/Store')
    for (const sig of decorations) {
      if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
      const rec = await this.#fetchRecord(store, sig)
      if (rec) out.push(rec)
    }
    return out
  }

  async #fetchRecord(store: StoreLike | undefined, sig: string): Promise<DecorationRecord | null> {
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      if (!blob) return null
      const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: Record<string, unknown> }
      if (typeof rec?.kind !== 'string') return null
      return { kind: rec.kind, payload: rec.payload }
    } catch { return null }
  }

  #emit(toggles: ViewToggle[]): void {
    EffectBus.emit('view-toggles:changed', { toggles })
  }
}

const _viewBee = new ViewBee()
window.ioc.register('@diamondcoreprocessor.com/ViewBee', _viewBee)
