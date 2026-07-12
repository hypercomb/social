// diamondcoreprocessor.com/commands/visual-bee-registry.ts
//
// VisualBeeRegistry — declarations of "visual bees": bees that produce a
// renderable view over a cell. A visual bee is anything with a slash
// command + an icon + a decoration kind, e.g. `/website`, `/audio`,
// `/story`, `/video`. Each bee writes its output as DECORATION JSONs —
// content-addressed resources (sig files at the flat OPFS root, via
// Store.putResource / the DecorationService facade; legacy `__resources__/`
// is a read-fallback) — and adds the resulting sigs to the cell's
// `decorationManifest` slot so the pointers ride in the merkle tree (and
// therefore are shared / adopted / undoable like any other slot value).
//
// ── Why a registry? ────────────────────────────────────────────────────
//
// Two consumers need to enumerate visual bees:
//
//   1. The RENDERER picks the visual bee whose decoration kind matches
//      the current view mode, then resolves its decorations (content
//      resources at the flat OPFS root) to render the cell.
//
//   2. ADOPTION surfaces a per-view opt-in icon. For an adopted tile,
//      walk every adoptable visual bee, check whether the peer's
//      manifest has entries with that kind — if so, render an icon
//      (looked up via IconProviderRegistry by `iconName`). Click =
//      copy peer's decoration JSONs into the local resource store (root
//      sig files) and append their sigs to the local cell's
//      `decorationManifest`.
//
// Both consumers depend on the same declarations, hence the registry.
//
// ── Pattern ────────────────────────────────────────────────────────────
//
// Mirrors IconProviderRegistry: EventTarget so consumers can rebuild
// when bees register / unregister mid-session. Idempotent register on
// `view` identity (re-registration of the same view name with a
// different object is dropped with a warning — programming error). The
// registry is a singleton stored in `window.ioc` under
// `@diamondcoreprocessor.com/VisualBeeRegistry`.
//
// ── Usage ──────────────────────────────────────────────────────────────
//
// Registration (at module load — colocate with the bee that owns it):
//
//     const registry = window.ioc.get(
//       '@diamondcoreprocessor.com/VisualBeeRegistry'
//     ) as VisualBeeRegistry | undefined
//     registry?.register({
//       view: 'website',
//       slashCommand: '/website',
//       iconName: 'website',
//       decorationKind: 'visual:website:page',
//       labelKey: 'view.website',
//       descriptionKey: 'view.website.description',
//       adoptable: true,
//     })
//
// Lookup (in renderer / adoption / palette):
//
//     const bee = registry?.get('website')
//     const beeFromKind = registry?.byDecorationKind('visual:website:page')
//     const allAdoptable = registry?.adoptable() ?? []
//
// You may import the TYPE relatively for typing only — type imports are
// stripped at compile time. NEVER instantiate VisualBeeRegistry yourself
// or import the class symbol non-type-only — that bundles a second copy
// into your bee and silently breaks the singleton.

export type VisualBeeDescriptor = {
  /**
   * Unique identity. e.g. `'website'`, `'audio'`, `'story'`. Used as the
   * registry key and as the view-mode token when switching surfaces.
   */
  readonly view: string

  /**
   * Slash command that drives this bee. e.g. `'/website'`. Informational
   * — the registry does not parse or dispatch the command. Used for
   * palette completion / tooltips.
   */
  readonly slashCommand: string

  /**
   * Name of the icon registered with `IconProviderRegistry`. Adoption UI
   * looks up the icon by this name when rendering per-view opt-in
   * chips on an adopted tile.
   */
  readonly iconName: string

  /**
   * Material Symbols ligature shown when this view is offered as a toggle
   * on the right side of the command line (e.g. `'web'` for website).
   * Distinct from `iconName` (which keys into IconProviderRegistry for the
   * adoption chips).
   *
   * This is the DEFAULT / fallback glyph for the view as a whole. A toggle
   * can override it PER-INSTANCE via the node's decoration: ViewBee reads
   * `payload.icon` (and optional `payload.label`) off the node's
   * `<decorationKind>` record and prefers it, so every website carries its
   * own distinct glyph and the user can change it later by rewriting the
   * decoration. `toggleIcon` is used only when the decoration doesn't set
   * one. Optional — ViewBee falls back to a generic glyph when both are
   * absent.
   */
  readonly toggleIcon?: string

  /**
   * Whether this view surfaces a per-node toggle on the command line
   * (ViewBee). Defaults to true. A view whose members are launched from the
   * launch-group aggregator (website — the cloud tiles) sets false: the
   * launcher already owns opening it, so a second button beside the launcher
   * icons is redundant. The slash command stays the escape hatch.
   */
  readonly commandLineToggle?: boolean

  /**
   * What kind of view this is:
   *   - `'render'` (default when absent): an alternate RENDER of the same
   *     branch (e.g. website). Availability comes from a decoration/page on
   *     the node; toggling drives `ViewModeService` (hexagons ⇄ view).
   *   - `'navigation'`: not a render surface but a place you go (e.g. the
   *     dashboard bag). Availability, active-state, and the toggle action are
   *     delegated to a controller bee (see `controllerKey`); toggling
   *     navigates into / back out of a lineage instead of switching render mode.
   */
  readonly behavior?: 'render' | 'navigation'

  /**
   * For `behavior: 'navigation'` views only. IoC key of the bee that owns
   * this view's navigation. ViewBee resolves it and delegates to its
   * `isAvailable()`, `isActive()`, and `toggleBehavior()` methods — the
   * navigation-behavior controller contract.
   */
  readonly controllerKey?: string

  /**
   * Decoration-record `kind` string written by this bee. Decoration
   * JSONs (content resources at the flat OPFS root) carry
   * `{ kind, appliesTo, payload }` and the renderer / adoption use this
   * string to filter records.
   *
   * Convention: `visual:<view>:<noun>`, e.g. `'visual:website:page'`,
   * `'visual:audio:track'`. Multiple kinds per view are allowed (declare
   * multiple bees with the same `view` but different `decorationKind` —
   * the registry stores by `view`, so only the last wins; if you need
   * multiple kinds per view, declare them as separate views or split
   * into sub-bees).
   */
  readonly decorationKind: string

  /**
   * For `behavior: 'render'` views whose content is a FIRST-CLASS LAYER
   * SLOT (not a decoration): the slot name on the layer JSON (e.g.
   * `'tutor'`). When set, ViewBee surfaces the per-node toggle whenever
   * this cell's slot is a non-empty signature array — no `decorations`
   * dual-write needed. The decoration path still works for views that use
   * it (website), so a view may declare a slot, a decorationKind, or both;
   * ViewBee shows the toggle if EITHER is present on the cell.
   */
  readonly slot?: string

  /** i18n key for the view's label (tooltips, palette entries). */
  readonly labelKey?: string

  /** i18n key for the view's description (hover / help). */
  readonly descriptionKey?: string

  /**
   * Whether this feature CASCADES to a subtree. When a cascading feature is
   * declared on a container, it applies to every descendant (top-down) —
   * like the typed file dropbox. The features panel uses this to report a
   * feature's ORIGIN on a child tile: a cascading feature found on an
   * ancestor is shown as "cascaded from <ancestor>", whereas a feature in
   * the tile's own slot is "direct". Default (absent / false) = node-local:
   * an alternate render that lives only on the node it was declared on (e.g.
   * a website page), never inherited by descendants.
   */
  readonly cascades?: boolean

  /**
   * How much of the tile's tree travels when this feature is ADOPTED.
   *   - `'tile'` (default when absent): only the tile the feature lives on —
   *     its slots/decorations, no children.
   *   - `'hierarchy'`: the tile PLUS its owned child subtree. A feature whose
   *     content IS a subtree — a website, whose pages are child cells — MUST
   *     declare this, so adopting the feature carries the page-tiles, not just
   *     the host cell's `website` slot. Honored on BOTH adopt paths: the
   *     not-held fold already re-homes the whole subtree (flattenLayerTree);
   *     the held-tile diff-merge folds the peer's owned missing children after
   *     merging the feature. "When owned" is a SHARE-side rule (a contributor
   *     can only offer a hierarchy they own) — the adopt side trusts the
   *     published branch's own children, the same as any subtree fold.
   *
   * Distinct from `cascades`: cascade is top-down INHERITANCE of a behavior by
   * descendants; adoptScope is how far the fold reaches when the feature is
   * pulled onto another hive.
   */
  readonly adoptScope?: 'tile' | 'hierarchy'

  /**
   * Where this behavior's records LIVE — the undo/redo opt-out (see
   * documentation/aggregation-layer-model.md).
   *   - `'layer'` (default when absent): records ride layers/commits —
   *     undoable, adoptable, foldable with the group. A layer IS its
   *     history, so there is no "on the layer but hidden from undo" state.
   *   - `'derived'`: records ride a pool/cache — recomputable, wipe-safe,
   *     NEVER undoable or shareable. Reserve for genuinely transient or
   *     derived data (the optimize-phase litmus: rebuildable from layers
   *     alone).
   */
  readonly resourceScope?: 'layer' | 'derived'

  /**
   * IoC key of the QueenBee that handles this view's slash command.
   * Used by the adoption-icon click handler to dispatch the bee for the
   * clicked cell (`queen.invoke(args)`). Optional: if absent, the icon
   * click emits a generic `visual-bee:adopt-request` event the bee's
   * own listener can pick up.
   */
  readonly queenKey?: string

  /**
   * Whether the view surfaces as an adoption opt-in icon. Defaults to
   * true. Set false for visual bees whose output should never transfer
   * via tile adoption (e.g. views that depend on local-only state).
   */
  readonly adoptable?: boolean
}

/**
 * Singleton registry instance — registered with `window.ioc` at module
 * load. Consumers obtain it via
 * `window.ioc.get('@diamondcoreprocessor.com/VisualBeeRegistry')`.
 *
 * EventTarget so consumers can rebuild views / icons when bees register
 * or unregister mid-session (toggle a drone off in DCP → its visual bee
 * removes itself → adoption UI re-renders without the icon).
 */
export class VisualBeeRegistry extends EventTarget {

  readonly #bees = new Map<string, VisualBeeDescriptor>()

  /**
   * Register a visual bee. Idempotent for the same descriptor reference
   * (hot-reload safe); registering a different object under the same
   * `view` name logs a warning and is ignored (programming error — two
   * bees competing for one view identity).
   */
  register(bee: VisualBeeDescriptor): void {
    if (!bee?.view || typeof bee.view !== 'string') {
      throw new Error('[VisualBeeRegistry] bee.view must be a non-empty string')
    }
    if (!bee.slashCommand || typeof bee.slashCommand !== 'string') {
      throw new Error(`[VisualBeeRegistry] bee "${bee.view}" must declare a slashCommand`)
    }
    if (!bee.iconName || typeof bee.iconName !== 'string') {
      throw new Error(`[VisualBeeRegistry] bee "${bee.view}" must declare an iconName`)
    }
    if (!bee.decorationKind || typeof bee.decorationKind !== 'string') {
      throw new Error(`[VisualBeeRegistry] bee "${bee.view}" must declare a decorationKind`)
    }
    const existing = this.#bees.get(bee.view)
    if (existing && existing !== bee) {
      console.warn(`[visual-bee-registry] duplicate view "${bee.view}" — ignoring re-registration`)
      return
    }
    if (existing === bee) return // idempotent
    this.#bees.set(bee.view, bee)
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Unregister by view name. No-op if absent. */
  unregister(view: string): void {
    if (!this.#bees.delete(view)) return
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** All registered bees, in insertion order. */
  all(): VisualBeeDescriptor[] {
    return [...this.#bees.values()]
  }

  /** Bees whose `adoptable` is not explicitly false. */
  adoptable(): VisualBeeDescriptor[] {
    return this.all().filter(b => b.adoptable !== false)
  }

  /** Look up a bee by its `view` name. */
  get(view: string): VisualBeeDescriptor | undefined {
    return this.#bees.get(view)
  }

  /** Look up the bee that owns a decoration kind. */
  byDecorationKind(kind: string): VisualBeeDescriptor | undefined {
    for (const bee of this.#bees.values()) {
      if (bee.decorationKind === kind) return bee
    }
    return undefined
  }
}

// Singleton: one instance per app, registered with window.ioc so every
// consumer (across bees, namespaces) shares it.
const _visualBeeRegistry = new VisualBeeRegistry()
window.ioc.register('@diamondcoreprocessor.com/VisualBeeRegistry', _visualBeeRegistry)
