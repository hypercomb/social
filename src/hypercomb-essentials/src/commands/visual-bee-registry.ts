// commands/visual-bee-registry.ts
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
//       toggleIcon: 'web',
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

import {
  BEHAVIOR_PHEROMONES_KEY,
  PLATFORM_DESKTOP,
  PLATFORM_MOBILE,
} from '../preferences/mobile-pheromones.js'
import type { AgentAvatarSpec } from '../presentation/avatars/agent-avatar.js'

/**
 * One thing a behaviour can be told in a call. Descriptive only — see
 * `VisualBeeDescriptor.parameters`.
 */
export type BehaviourParameter = {
  /** How it is written as a named argument: `title: "Meetup"`. Also the label
   *  in the signature hint. */
  readonly name: string
  /** What shape of value it wants. Shown in the hint as `<message>` /
   *  `<number>`; nothing coerces on its account. */
  readonly type?: 'text' | 'number' | 'boolean'
  /** The parameter the PAREN-LESS form fills — the rest of the line goes here.
   *  At most one per behaviour; it is the one the signature leads with. */
  readonly primary?: boolean
  /** i18n key for the one-line explanation shown beside the name. */
  readonly descriptionKey?: string
  /** Shown when no catalog has the key — never "no description". */
  readonly fallbackDescription?: string
}

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
   * absent. Every behavior must declare its own unique ligature: management
   * views use this as the behavior's stable visual identity.
   */
  readonly toggleIcon: string

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
   *   - `'navigation'`: not a render surface but a place you go (a lineage
   *     bag). Availability, active-state, and the toggle action are
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
   * RETIRED kind strings this bee still answers for. A rename mints a new
   * `decorationKind`, but marks written under the old name live on layers
   * in the wild (and on adopted branches) forever — these keep them
   * recognized: `byDecorationKind` resolves them to this bee, and ViewBee's
   * presence checks match them alongside the current kind. Writers always
   * use `decorationKind`; legacy kinds are read-side only.
   */
  readonly legacyKinds?: readonly string[]

  /**
   * FURTHER LIVE kinds this bee answers for — distinct from `legacyKinds`,
   * which is retired spellings of one thing. Use it when a view is genuinely
   * entered from two DIFFERENT artifacts: the slides view is opened both from
   * a `visual:diagram:slide` (play the presentation AT this slide) and from
   * the `visual:site:artifact` that relates them (play it from the start).
   *
   * The pair is a PEER relationship, never a container one — that is the whole
   * reason a second kind is honest here instead of a parent kind that owns its
   * children. A view whose second kind would merely be "the thing that holds
   * the first" does not want this; it wants a pheromone
   * (documentation/website-artifact-paradigm.md).
   *
   * Writers still use `decorationKind` for the member component; a bee that
   * writes an `alsoKinds` record does it explicitly, from its own command.
   */
  readonly alsoKinds?: readonly string[]

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

  /**
   * How far this view's availability REACHES from the cell that carries it.
   *   - `'node'` (default when absent): node-local. The toggle surfaces only
   *     on the cell holding the slot / decoration (home, slides, tutor).
   *   - `'branch'`: an APPLICATION SCOPE declared at a ROOT — every descendant
   *     is a member WITHOUT stamping. ViewBee walks the lineage outermost-first
   *     and surfaces the toggle anywhere INSIDE the hierarchy whose root
   *     carries the feature. The walk probes STRICT prefixes only, so standing
   *     on the PARENT of a scope root (where it merely sits as a child) never
   *     matches — step outside the hierarchy and the toggle drops.
   *
   * This is the doctrine-pure way to say "the icon follows you around inside
   * this tree": the classification lives on the root TILE as a decoration, so
   * ANY cell becomes a scope root by being marked (`name@view` when the bee is
   * `attachable`) — no per-feature code, no hardcoded path. Also widens the
   * hidden-pool gate to hide by BRANCH, the same reach as `cascades`.
   */
  readonly scope?: 'node' | 'branch'

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
   * Source reaches this view lets a participant choose when attaching it.
   * The choice is stored per declaration as `payload.sourceScope`.
   * `'layer'` reads direct children; `'hierarchy'` reads all descendants.
   *
   * A `'hierarchy'` attachment also means the view APPLIES all the way down
   * that hierarchy, one layer at a time: ViewBee walks the lineage and
   * offers the toggle icon on every descendant of the declaring cell, and a
   * descendant that opens it renders its OWN layer (no local declaration →
   * default layer reach). A `'layer'` attachment stays node-local.
   *
   * Omit for views whose reach is intrinsic (websites, decks, and trees).
   * The Views window offers this choice only when a renderer declares it.
   */
  readonly sourceScopes?: readonly ('layer' | 'hierarchy')[]

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

  /**
   * Whether this behaviour can be ATTACHED declaratively — its content is
   * whatever the cell already has (slides play the cell's children), so
   * writing `decorationKind` at the target IS the whole install.
   *
   * The `name@view` command line and the Beehaviors panel use this to attach
   * it directly instead of falling back to running the bee's slash command
   * (which for a view bee TOGGLES the view rather than attaching anything —
   * `diagram@slides` used to flip the current cell into slides instead of
   * making `diagram` a deck). Leave unset for behaviours whose content must
   * be authored first (a website page, a tutor deck).
   */
  readonly attachable?: boolean

  /**
   * What this behaviour can be TOLD, when written as a call —
   * `meetup@postit Doors at 7` or `meetup@postit("Doors at 7", title: "Meetup")`.
   *
   * Declaring it does two things and only two: the command line shows the
   * behaviour's SIGNATURE while you are choosing it (so `postit <message>`
   * tells you it takes one at all), and it completes NAMED parameters once
   * you open a parenthesis (so `title:` is recalled rather than remembered).
   *
   * It is documentation, never enforcement. The behaviour's own `applyCall`
   * remains the single authority on what it accepts — a declaration that
   * drifted from the code would be worse than none, so nothing validates
   * against this list. Omit it for behaviours that take no message; the
   * absence is what the command line reports when someone tries.
   */
  readonly parameters?: readonly BehaviourParameter[]

  /**
   * Whether this behavior's on-tile ICON opens the view in place rather than
   * navigating into the tile before switching modes.
   *
   * The property keeps its original name for descriptor compatibility. Tile
   * BODY clicks always navigate normally; behaviors are launched explicitly
   * from their distinct `view-enter:*` icons.
   */
  readonly opensOnTileClick?: boolean

  /**
   * Legacy ordering hint retained for descriptor compatibility. Defaults no
   * longer take over tile-body navigation; the participant's per-tile choice
   * (`hc:view-defaults`) accents the matching behavior icon instead.
   */
  readonly takeoverRank?: number

  /**
   * TILES ARE ASSETS for this view: a cell carrying this bee's decoration
   * kind does not render as a hexagon at all — the view owns the cell's
   * entire on-screen presence (the post-it's sticky, a gallery's frame).
   * The hex render drops the label through the same union filter as hides,
   * so the show-hidden toggle doubles as the X-ray that reveals the
   * underlying tile; the view's own surface is the only ordinary way in.
   * Default false: most views are an ALTERNATE render a tile offers, not a
   * replacement for its presence.
   */
  readonly replacesTileRender?: boolean

  /**
   * Capability pheromones this behaviour SHIPS — how a module self-declares
   * what it is good for, so no one has to chase modules down to tag them.
   * Every behaviour MUST include `platform:mobile`, `platform:desktop`, or
   * both. Content remains universal; these capability marks are the first-class
   * boundary controlling which behaviour a shell activates.
   *
   * DECLARED, NEVER SEEDED: this array is re-asserted on every module load
   * and is never written to storage, so a module update that changes it can
   * never clobber a user's choice and there is no stale default to migrate.
   * The EFFECTIVE set folds in participant-local overrides — see
   * `effectivePheromones` / `withPheromone` and mobile-experience-plan.md §4.4.
   */
  readonly pheromones?: readonly string[]

  /**
   * This behaviour's AVATAR — the bee the hive shows while it is working (see
   * presentation/avatars/agent-avatar.ts). Colours, or a resource signature
   * for a custom image.
   *
   * DECLARED, NEVER SEEDED, same as `pheromones`: a participant override wins,
   * and a behaviour that declares nothing still gets a distinct bee derived
   * from its `view` name. Declare one only when the behaviour has a look it
   * wants to be recognised by.
   */
  readonly avatar?: AgentAvatarSpec
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
    if (!bee.toggleIcon || typeof bee.toggleIcon !== 'string') {
      throw new Error(`[VisualBeeRegistry] bee "${bee.view}" must declare a toggleIcon`)
    }
    if (!bee.decorationKind || typeof bee.decorationKind !== 'string') {
      throw new Error(`[VisualBeeRegistry] bee "${bee.view}" must declare a decorationKind`)
    }
    const declared = new Set(bee.pheromones ?? [])
    if (!declared.has(PLATFORM_MOBILE) && !declared.has(PLATFORM_DESKTOP)) {
      throw new Error(
        `[VisualBeeRegistry] bee "${bee.view}" must declare platform:mobile, platform:desktop, or both`,
      )
    }
    const existing = this.#bees.get(bee.view)
    if (existing && existing !== bee) {
      console.warn(`[visual-bee-registry] duplicate view "${bee.view}" — ignoring re-registration`)
      return
    }
    if (existing === bee) return // idempotent
    const iconOwner = [...this.#bees.values()].find(
      other => other.view !== bee.view && other.toggleIcon === bee.toggleIcon,
    )
    if (iconOwner) {
      throw new Error(
        `[VisualBeeRegistry] bee "${bee.view}" must use its own toggleIcon; ` +
        `"${bee.toggleIcon}" already belongs to "${iconOwner.view}"`,
      )
    }
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

  /**
   * Decoration kinds whose owner view REPLACES the tile's hex render —
   * tiles are ASSETS for those views (see `replacesTileRender`). The hex
   * renderer consults this set on every pass; registry-driven, so no view
   * is ever named in the renderer.
   */
  kindsReplacingTileRender(): Set<string> {
    const out = new Set<string>()
    for (const bee of this.#bees.values()) {
      if (bee.replacesTileRender) out.add(bee.decorationKind)
    }
    return out
  }

  /** Look up the bee that owns a decoration kind — current, further-live
   *  (`alsoKinds`) or retired (`legacyKinds`). */
  byDecorationKind(kind: string): VisualBeeDescriptor | undefined {
    for (const bee of this.#bees.values()) {
      if (bee.decorationKind === kind) return bee
      if (bee.alsoKinds?.includes(kind)) return bee
      if (bee.legacyKinds?.includes(kind)) return bee
    }
    return undefined
  }

  /**
   * The EFFECTIVE pheromone set for a view: (declared ∪ add) − remove, where
   * `add` / `remove` come from participant-local overrides in localStorage
   * (`hc:behavior-pheromones`, keyed by the stable `view` name). The declared
   * defaults are recomputed every call — never persisted — so a module update
   * that changes its declaration can never clobber a user's choice and there
   * is no stale seed to migrate. See mobile-experience-plan.md §4.4.
   */
  effectivePheromones(view: string): Set<string> {
    const bee = this.#bees.get(view)
    const set = new Set<string>(bee?.pheromones ?? [])
    const ov = this.#pheromoneOverrides()[view]
    ov?.add?.forEach(p => set.add(p))
    ov?.remove?.forEach(p => set.delete(p))
    return set
  }

  /** All registered bees whose EFFECTIVE pheromone set contains `name`. */
  withPheromone(name: string): VisualBeeDescriptor[] {
    return this.all().filter(b => this.effectivePheromones(b.view).has(name))
  }

  /** Behaviours available on a shell after participant-local overrides. */
  forPlatform(platform: 'mobile' | 'desktop'): VisualBeeDescriptor[] {
    return this.withPheromone(platform === 'mobile' ? PLATFORM_MOBILE : PLATFORM_DESKTOP)
  }

  /** Participant-local behavior-pheromone overrides. Read fresh each call —
   *  cheap, and keeps updates honest (no cached seed to go stale). */
  #pheromoneOverrides(): Record<string, { add?: string[]; remove?: string[] }> {
    try {
      const raw = localStorage.getItem(BEHAVIOR_PHEROMONES_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }
}

// Singleton: one instance per app, registered with window.ioc so every
// consumer (across bees, namespaces) shares it.
const _visualBeeRegistry = new VisualBeeRegistry()
window.ioc.register('@diamondcoreprocessor.com/VisualBeeRegistry', _visualBeeRegistry)
