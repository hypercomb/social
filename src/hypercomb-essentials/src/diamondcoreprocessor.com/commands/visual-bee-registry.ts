// diamondcoreprocessor.com/commands/visual-bee-registry.ts
//
// VisualBeeRegistry — declarations of "visual bees": bees that produce a
// renderable view over a cell. A visual bee is anything with a slash
// command + an icon + a decoration kind, e.g. `/website`, `/audio`,
// `/story`, `/video`. Each bee writes its output as DECORATION JSONs in
// the `__optimization__` substrate (via Store.putOptimization) and adds
// the resulting sigs to the cell's `decorationManifest` slot so the
// pointers ride in the merkle tree (and therefore are shared / adopted /
// undoable like any other slot value).
//
// ── Why a registry? ────────────────────────────────────────────────────
//
// Two consumers need to enumerate visual bees:
//
//   1. The RENDERER picks the visual bee whose decoration kind matches
//      the current view mode, then resolves its decorations against
//      `__optimization__` to render the cell.
//
//   2. ADOPTION surfaces a per-view opt-in icon. For an adopted tile,
//      walk every adoptable visual bee, check whether the peer's
//      manifest has entries with that kind — if so, render an icon
//      (looked up via IconProviderRegistry by `iconName`). Click =
//      copy peer's decoration JSONs into local `__optimization__` and
//      append their sigs to the local cell's `decorationManifest`.
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
   * adoption chips). Optional — ViewBee falls back to a generic glyph when
   * absent.
   */
  readonly toggleIcon?: string

  /**
   * Optimization-record `kind` string written by this bee. Decoration
   * JSONs in `__optimization__` carry `{ kind, appliesTo, payload }` and
   * the renderer / adoption use this string to filter records.
   *
   * Convention: `visual:<view>:<noun>`, e.g. `'visual:website:page'`,
   * `'visual:audio:track'`. Multiple kinds per view are allowed (declare
   * multiple bees with the same `view` but different `decorationKind` —
   * the registry stores by `view`, so only the last wins; if you need
   * multiple kinds per view, declare them as separate views or split
   * into sub-bees).
   */
  readonly decorationKind: string

  /** i18n key for the view's label (tooltips, palette entries). */
  readonly labelKey?: string

  /** i18n key for the view's description (hover / help). */
  readonly descriptionKey?: string

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
