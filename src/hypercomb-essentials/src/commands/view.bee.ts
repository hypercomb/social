// commands/view.bee.ts
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
import { isBehaviorDormant, ENABLEMENT_CHANGED } from '../sharing/behavior-enablement.js'
import { DEFAULT_VIEW_DECORATION_KIND, normalizeViewToken } from './decoration-kind-index.js'
import { defaultViewWithinAt } from './view-default.js'

const SIG_RE = /^[0-9a-f]{64}$/
/** Fallback glyph when a view forgets to declare a Material toggleIcon. */
const FALLBACK_TOGGLE_ICON = 'visibility'
/** The render surface websites toggle against. */
const DEFAULT_SURFACE = 'hexagons'

/** Joins a path into one latch key. A separator no tile name can contain, so
 *  `['a','b']` and `['a/b']` are never the same address. */
const SEGMENT_SEPARATOR = String.fromCharCode(0)

/** Does this record's kind belong to the view — under its current name, a
 *  further LIVE one (`alsoKinds`, a peer artifact that enters the same view),
 *  OR a retired one (`legacyKinds`)? Marks written before a rename live on
 *  layers forever; presence must keep answering for them. */
const recordBelongsTo = (v: VisualBeeDescriptor, kind: string): boolean =>
  kind === v.decorationKind
  || (v.alsoKinds?.includes(kind) ?? false)
  || (v.legacyKinds?.includes(kind) ?? false)

type LineageLike = EventTarget & {
  domain?: () => string
  explorerSegments?: () => readonly string[]
  explorerLabel?: () => string
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
  /** This layer's `view:default` mark names THIS view — the face it opens as.
   *  A standing fact about the place, not a live state: it is true whether or
   *  not the view is currently up, which is exactly why the rail has to show
   *  it. Back on the hexagons every toggle is `active:false`, and without
   *  this the participant cannot tell which one the layer will open as. */
  readonly isDefault: boolean
}

export class ViewBee extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'view'

  public override description =
    'ViewBee — surfaces available view behaviors (e.g. website) as command-line toggles and flips the global render surface.'

  protected override emits: string[] = ['view-toggles:changed', 'view:arrival']

  /** Microtask coalescing — a single navigation fires several triggers
   *  (lineage change + render:cell-count + decorations:changed); collapse
   *  them into one async recompute per tick. */
  #pending = false

  /** The location whose ARRIVAL SURFACE has already been decided, so a
   *  recompute at the same address never re-opens a view the participant
   *  escaped out of. Null = armed. */
  #autoOpenedKey: string | null = null

  /** The view the most recent arrival OPENED ('' = none, or the surface was
   *  the participant's own doing). This is what tells "a view the
   *  participant chose" apart from "the previous layer's arrival surface
   *  still up when we land somewhere new": the participant's choice rides
   *  along on a walk, but a PLACE's claim ends where the place does. */
  #autoOpenedView = ''

  /** Cancel handle for a release that is waiting on the destination's
   *  paint (see #releaseWhenPainted). Non-null while one is armed. */
  #pendingRelease: (() => void) | null = null

  /** INHERITED arrival face per address — the nearest ancestor's
   *  `view:default`, resolved by an O(depth) decoration walk. #recompute
   *  fires many times at one address (cell-count, ViewMode, enablement),
   *  and the ancestors' marks cannot change between those triggers without
   *  a decoration or cursor event — the two that clear this. */
  #inheritedDefault = new Map<string, string>()

  /** Nearest ancestor's default view for the address ('' = none / opted
   *  out). The node's OWN mark is the caller's to read — it already holds
   *  the layer's records; this walk starts at the parent. */
  async #inheritedDefaultView(segments: readonly string[]): Promise<string> {
    if (!segments.length) return ''
    const key = segments.join(SEGMENT_SEPARATOR)
    const hit = this.#inheritedDefault.get(key)
    if (hit !== undefined) return hit
    const view = await defaultViewWithinAt(segments.slice(0, -1)).catch(() => '')
    this.#inheritedDefault.set(key, view)
    return view
  }

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
    EffectBus.on('decorations:changed', () => {
      // An ancestor's mark may have changed — the inherited-face memo is
      // only valid between decoration events.
      this.#inheritedDefault.clear()
      this.#schedule()
    })

    // The layer's DEFAULT VIEW mark landed (or was cleared) — re-arm the
    // arrival latch so setting one from the Beehaviors panel shows you what
    // you just chose. Only for THIS layer's mark: a child's default being
    // indexed by the hydration walk must never re-open a view the
    // participant has just escaped out of.
    EffectBus.on<{ label?: string }>('default-view:indexed', (payload) => {
      // Whatever cell it landed on, it may be an ancestor of somewhere the
      // memo has already answered for.
      this.#inheritedDefault.clear()
      const lineage = get<LineageLike>('@hypercomb.social/Lineage')
      const here = (lineage?.explorerSegments?.() ?? [])
        .map(s => String(s ?? '').trim()).filter(Boolean)
      if (String(payload?.label ?? '') !== (here[here.length - 1] ?? '')) return
      this.#autoOpenedKey = null
      this.#schedule()
    })

    // The cursor rebinding to a new location (or the user rewinding) changes
    // which layer "here" resolves to. Without this, a navigation whose
    // cursor.load() finished after our last recompute left the PREVIOUS
    // node's toggles (the website icon) stuck on the new page.
    EffectBus.on('history:cursor-changed', () => {
      // Undo/rewind can add or drop an ancestor's mark without a live
      // decoration event — drop the inherited-face memo with the cursor.
      this.#inheritedDefault.clear()
      this.#schedule()
    })

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

    // The GLOBAL roster (behavior-enablement lens). A behavior flipped off
    // there goes dormant everywhere at once: drop its toggle, and if it owns
    // the current surface, release it — same transition as feature:hidden.
    // Flipping it back on wakes every toggle on the next recompute.
    EffectBus.on(ENABLEMENT_CHANGED, () => {
      void this.#enforceActiveViewEnabled()
      this.#schedule()
    })

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
    // Dormant (global roster off / publisher-withheld, no wake here) — the
    // surface must fall back to hexagons exactly as a hide does.
    if (isBehaviorDormant(descriptor.decorationKind, segments)) {
      if (vm.mode === descriptor.view) vm.setMode(DEFAULT_SURFACE)
      return
    }
    const branchScoped = descriptor.scope === 'branch' || !!descriptor.cascades
    const hidden = await (branchScoped
      ? isFeatureHiddenWithin(segments, descriptor.decorationKind)
      : isFeatureHidden(segments, descriptor.decorationKind)).catch(() => false)
    if (hidden && vm.mode === descriptor.view) vm.setMode(DEFAULT_SURFACE)
  }

  /** Is the surface currently up the ARRIVAL FACE of the location we are
   *  standing on? The back gesture asks: backing out of a FACE is a
   *  NAVIGATE — a navigate is a navigate, and the destination's view is
   *  its default or not — while backing out of a view the participant
   *  opened themselves just closes it. */
  isArrivalSurface = (): boolean => {
    if (!this.#autoOpenedView) return false
    const vm = get<ViewModeLike>('@hypercomb.social/ViewMode')
    if (!vm || vm.mode !== this.#autoOpenedView) return false
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    return this.#autoOpenedKey === segments.join(SEGMENT_SEPARATOR)
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
    // The layer's ARRIVAL FACE, read once for both consumers: the strip marks
    // it, and #openDefaultView opens it. THE CASCADE: the layer's own mark
    // wins; with none, the NEAREST ancestor's mark covers this page — a
    // default is a fact about a place, and the place reaches everything under
    // it until a descendant declares its own. An explicit `hexagons` mark is
    // that declaration's opt-out: it resolves to no face at all.
    const ownDefault = normalizeViewToken(String(
      records.find(r => r.kind === DEFAULT_VIEW_DECORATION_KIND)?.payload?.['view'] ?? '',
    ).trim())
    const resolved = ownDefault || await this.#inheritedDefaultView(segments)
    // An explicit `hexagons` mark is the OPT-OUT: "no view here, and
    // deliberately so" — it must also RELEASE an inherited arrival surface
    // that would otherwise ride along (see #openDefaultView).
    const optedOut = resolved === DEFAULT_SURFACE
    const defaultView = optedOut ? '' : resolved

    const toggles: ViewToggle[] = []
    for (const v of views) {
      if (!v?.view) continue

      // Dormant behavior (global roster off / publisher-withheld, no wake
      // covering this node) — no toggle at all. "Disappear for all intents
      // and purposes"; the decoration stays on the tile, and re-enabling
      // globally brings the toggle straight back.
      if (v.decorationKind && isBehaviorDormant(v.decorationKind, segments)) continue

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
          // A navigation behaviour opens a lineage, not a surface, so it can
          // never be what a layer opens AS (#defaultViewAt refuses one).
          isDefault: false,
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
        const record = records.find(r => recordBelongsTo(v, r.kind))
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
      if (!present && walkable && segments.length > 0) {
        const root = await this.#branchScopeRoot(segments, v)
        if (root) {
          present = true
          hierarchyMember = v.scope !== 'branch'
          const record = v.decorationKind ? root.records.find(r => recordBelongsTo(v, r.kind)) : undefined
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
        isDefault: !!defaultView && v.view === defaultView,
      })
    }
    this.#emit(toggles)
    this.#openDefaultView(segments, toggles, layer, defaultView, vm, optedOut)
  }

  /** THE ARRIVAL SURFACE — a layer can declare which view it opens as, and
   *  walking in lands on it instead of on hexagons. The mark is
   *  `view:default` on the layer, written by clicking a view row's icon in
   *  the Beehaviors panel or ctrl/cmd-clicking the view's icon on the header
   *  rail; one per layer, so there is nothing to arbitrate. `want` is that
   *  mark, read by the caller (it also marks the strip with it).
   *
   *  Every gate above is inherited for free by asking one question — is this
   *  view in the toggle strip we just built? Dormant, hidden, not present
   *  here, outside its branch scope, a navigation behaviour with no
   *  controller: all of them already removed it, and none of them has to be
   *  re-checked (or re-forgotten) here.
   *
   *  The decision runs PRE-PAINT — it deliberately does not wait for the
   *  first hexagon paint. A layer that opens as a view should never show
   *  hexagons at all, so show-cell holds its paint while this arbitration is
   *  pending and skips it entirely when the view opens (its ARRIVAL GATE).
   *  Waiting for paint here would deadlock that hold. The old white-screen
   *  fear (mounting a canvas-hiding view during boot) does not apply: the
   *  toggle gate proves the view has content to mount at this very node,
   *  which is exactly what a stale persisted transient mode lacked.
   *
   *  Whatever is decided, the VERDICT is announced as `view:arrival` —
   *  `{ segments, view }` with `view: ''` meaning "this layer opens as
   *  hexagons". show-cell's gate and the boot splash both key on it: the
   *  gate releases (paint or skip), and the splash treats a non-empty view
   *  as its ready signal, since the hexagon paint it normally waits for
   *  (`render:cell-count`) is the very thing being skipped. */
  #openDefaultView(
    segments: readonly string[],
    toggles: readonly ViewToggle[],
    layer: LayerLike | null,
    want: string,
    vm: ViewModeLike,
    optedOut = false,
  ): void {
    // A cold layer read is indistinguishable from "no default" — don't latch
    // on it, let the next trigger answer properly.
    if (layer === null) return
    const key = segments.join(SEGMENT_SEPARATOR)
    if (this.#autoOpenedKey === key) return
    const prevArrival = this.#autoOpenedView
    // A NEW decision supersedes any release still waiting on a paint — the
    // participant moved again before the old destination's tiles landed.
    this.#pendingRelease?.()
    // Latch BEFORE deciding, and latch even when the answer is "nothing to
    // open": #recompute re-runs many times at one address (cell-count,
    // decorations, ViewMode change, enablement flips), and a second pass must
    // not undo an Escape back to the hexagons.
    this.#autoOpenedKey = key
    const available = !!want && toggles.some(t => t.view === want)
    // Whose is the surface that's up? A view the PARTICIPANT chose rides
    // along on a walk — never yank them out of it into the one the layer
    // suggests. But the PREVIOUS layer's arrival surface is the old place's
    // claim, not a choice: landing somewhere new releases it, so this
    // layer's own default may take the surface. (Without this, walking from
    // one default-view layer into another left the old view "winning" a
    // surface it no longer had any right to — and the latch then blocked
    // the new default forever: the reported "loads back as hexagons".)
    let opened = ''
    if (available && vm.mode === want) opened = want
    else if (available && (vm.mode === DEFAULT_SURFACE || vm.mode === prevArrival)) {
      vm.setMode(want)
      opened = want
    } else if (!available && prevArrival && vm.mode === prevArrival
               && (optedOut || !toggles.some(t => t.view === prevArrival))) {
      // Walking OUT of the layer — and out of its whole scope: a
      // branch-scoped view (a website) keeps its toggle on every descendant,
      // so inside the scope this never fires — releases the arrival surface
      // back to the hexagons. NOT YET, though: the old face HOLDS until the
      // destination's tiles are painted, so the reveal shows the new grid —
      // never the previous page's mesh, never a blank field ("if a grid of
      // hexagons is supposed to show up it shouldn't glitch and show
      // something else in between").
      this.#releaseWhenPainted(vm, prevArrival)
    }
    if (opened) this.#autoOpenedView = opened
    else if (vm.mode !== prevArrival || !toggles.some(t => t.view === prevArrival)) {
      // The old arrival's surface is gone (released above, escaped, or the
      // participant switched views themselves) — drop the claim. Kept only
      // while still riding the previous arrival inside its own scope.
      this.#autoOpenedView = ''
    }
    EffectBus.emit('view:arrival', { segments: [...segments], view: opened })
  }

  /** Drop the surface to hexagons once show-cell's painted location catches
   *  up with where we stand. show-cell keeps painting under the covered
   *  canvas, so this is usually one render pass away; the timeout is the
   *  never-strand backstop (an empty destination still settles a pass, so
   *  it fires only when a pass errored out entirely). */
  #releaseWhenPainted(vm: ViewModeLike, face: string): void {
    let done = false
    let off: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (release: boolean): void => {
      if (done) return
      done = true
      off?.()
      if (timer !== null) clearTimeout(timer)
      if (this.#pendingRelease === cancel) this.#pendingRelease = null
      if (release && vm.mode === face) vm.setMode(DEFAULT_SURFACE)
    }
    const cancel = (): void => finish(false)
    const check = (): void => {
      const lineage = get<LineageLike>('@hypercomb.social/Lineage')
      const here = String(lineage?.explorerLabel?.() ?? '/')
      const painted = get<{ paintedLocationKey?: string }>('@diamondcoreprocessor.com/ShowCellDrone')?.paintedLocationKey
      if (painted === here) finish(true)
    }
    this.#pendingRelease = cancel
    // Last-value replay runs check synchronously — the destination's pass
    // may already have landed before this release was even decided.
    off = EffectBus.on('render:cell-count', check)
    if (done) { off(); off = null; return }
    timer = setTimeout(() => finish(true), 2500)
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
    // d = 0 is the HIVE ROOT — it can be a scope root like any other layer
    // (a mark on the root makes the whole hive its branch). Still strict
    // prefixes only: the walk never probes the node itself.
    for (let d = 0; d < segments.length; d++) {
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
        const record = records.find(r => recordBelongsTo(v, r.kind))
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
