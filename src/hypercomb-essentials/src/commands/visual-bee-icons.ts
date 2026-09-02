// commands/visual-bee-icons.ts
//
// Bridges VisualBeeRegistry → IconProviderRegistry. For every adoptable
// visual bee, registers an overlay icon (profile `public-external`) so
// peer-supplied views can be opted into on a tile. Click dispatches the
// bee's slash command for the clicked cell.
//
// ── How icons appear on a tile ────────────────────────────────────────
//
// tile-actions.drone.ts merges IconProviderRegistry entries with its
// built-in icon catalog and builds OverlayActionDescriptors. Each
// descriptor carries `visibleWhen(ctx)` evaluated per-tile by the
// overlay renderer — that's where peer-vs-own / has-decoration-of-kind
// filtering happens.
//
// Click handling: tile-actions emits `tile:action { action, label }`
// when an overlay icon fires. We listen for actions matching `view:*`
// and translate them into a slash-command dispatch — same effect as the
// user typing `/<view>` in the command palette, but scoped to the cell
// they clicked.
//
// ── Visibility predicate ──────────────────────────────────────────────
//
// `visibleWhen` is synchronous. The renderer can't await an OPFS read
// for each tile each frame, so the per-cell decoration-kind index
// (decoration-kind-index.ts) answers presence from memory, updated
// reactively as layers change.
//
// ── Per-feature adoption flow ─────────────────────────────────────────
//
// 1. Peer's layer has `decorations` slot entries. Adopter sees the slot
//    (already in the merkle tree).
// 2. For each entry whose kind is registered with VisualBeeRegistry,
//    the icon surfaces on the tile.
// 3. Click → slash command runs locally → writes a local decoration via
//    `writeDecoration`, sig lands in adopter's `decorations` slot.
// 4. Renderer reads adopter's slot, fetches decoration content, renders.
//
// Step 3 currently re-runs the command (e.g., regenerates the website
// via Claude). A future variant: "copy peer's exact sig" — same content
// hash, instant deduped fetch from the resource pipeline. That variant
// will be a click-modifier (shift-click to copy, click to regenerate).

import { EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry, VisualBeeDescriptor } from './visual-bee-registry.js'
import { hasDecorationKind, defaultViewForSegments } from './decoration-kind-index.js'
import { visualBeeIconSvg } from './visual-bee-icon-svg.js'
import { resolveViewEntrance } from './view-entrance.js'
import { VIEW_SPAWN_EFFECT } from '../presentation/tiles/view-spawn.js'
import { VIEW_ENTER_PREFIX, VIEW_OPEN_PREFIX, kindsOf } from '../presentation/tiles/viewer-walk.js'
import { isBehaviorDormant } from '../sharing/behavior-enablement.js'

/** IoC key for the shell-side icon registry. */
const ICON_REGISTRY_KEY = '@hypercomb.social/IconProviderRegistry'

/** Action-name prefix for visual-bee overlay icons. The tile-action
 *  dispatcher in this module listens for actions matching `view:*`. */
const VIEW_ACTION_PREFIX = 'view:'

/** Action-name prefix for ENTER icons — the behavior-provided affordance on a
 *  tile that already HAS the view's content (a website page, …). Clicking it
 *  goes to the tile and opens the view there — "go to the tile, click the
 *  website, and you're on the website". Complementary to `view:*` (the adopt
 *  opt-in shown when the content is absent). */
const ENTER_ACTION_PREFIX = VIEW_ENTER_PREFIX

/** Action-name prefix for OPEN icons — a view OFFERED on a tile that does not
 *  carry its kind, because the bee's own `offersFor(ctx)` says the tile is
 *  already the right shape (the scroller on any branch: the feed is simply
 *  the children). Pressed, it opens exactly as `view-enter:` does; it is a
 *  different name so the overlay can tint present and offered apart while the
 *  close-up lists both under "open as". */
const OPEN_ACTION_PREFIX = VIEW_OPEN_PREFIX

/** Action-name prefix for ASLEEP icons — the mark a tile wears while it is
 *  standing in for a TAKEOVER view whose behaviour is switched off.
 *
 *  Every other dormancy is silent by design: off means gone, and a tile that
 *  merely COULD have carried a lightbox loses nothing by not saying so. A
 *  takeover is the exception, because the hexagon on screen is not the cell's
 *  own presence — it is a stand-in for a view that has been put out
 *  (`replacesTileRender`, and show-cell's filter hands the hexagon back when
 *  the kind is dormant there). Without a mark that tile is a lie: the note is
 *  still on it, and nothing on the glass says so. Clicking opens Beehaviors
 *  on the tile, where the light is. */
const ASLEEP_ACTION_PREFIX = 'view-asleep:'

/** The asleep icon's colour. "A view is told by the colour of its icon, not by
 *  a badge" — so a put-out view is told the same way: the same glyph, in the
 *  grey of something switched off. */
const ASLEEP_TINT = 0x6b7681

/** Profile under which visual-bee icons register. `public-external`
 *  matches the "peer-supplied" semantics: these are features adopted
 *  from someone else's tile, surfaced in the pool of available icons
 *  rather than the always-on row. */
const ICON_PROFILE = 'public-external'

/** ── VIEWS WEAR THEIR OWN COLOUR ──────────────────────────────────────
 *  A view icon on a tile is not one more action: it is a way the tile can
 *  OPEN. So the view icons read as a FAMILY — cool blue among the white
 *  action glyphs — and the layer's DEFAULT wears the accent inside that
 *  family, because it is a promise about what walking in will show you.
 *
 *  The colour IS the whole cue. A tile never carries a separate badge for
 *  what it can open: the icon that opens the view is the same icon that
 *  says the view is there, and a second ornament in the corner would only
 *  repeat it. (Jaime, 2026-08-20 — "I didn't ask for any view badge on the
 *  tiles … you can give them different colors within the tile for the view
 *  items".) */
const VIEW_TINT = 0x7fb6e6
const VIEW_DEFAULT_TINT = 0xc8b8ff
const VIEW_HOVER_TINT = 0xdcefff
/** The offer to ADD a view — the same family spoken quieter, because the
 *  content is not on the tile yet. */
const VIEW_OFFER_TINT = 0x5f8199

type TileIconProvider = {
  name: string
  owner?: string
  svgMarkup: string
  /** Single profile (legacy shape) — prefer `profiles`. */
  profile?: string
  /** Profiles this icon lives in; expanded per-profile by tile-actions. */
  profiles?: readonly string[]
  /** Auto-join the default arrangement for the declared profiles. */
  defaultActive?: boolean
  /** Feature affordance — ⋮ reveals it bigger on the feature row(s). */
  featureRow?: boolean
  hoverTint?: number
  visibleWhen?: (ctx: unknown) => boolean
  tintWhen?: (ctx: unknown) => number | null | undefined
  labelKey?: string
  descriptionKey?: string
}

type IconProviderRegistry = {
  add(provider: TileIconProvider): void
  remove(name: string): void
}

const REGISTERED_ICONS = new Set<string>()

/** Compose the IconProviderRegistry name for a visual bee. */
function iconNameForBee(bee: VisualBeeDescriptor): string {
  return `${VIEW_ACTION_PREFIX}${bee.view}`
}

/** Compose the IconProviderRegistry name for a bee's ENTER icon. */
function enterIconNameForBee(bee: VisualBeeDescriptor): string {
  return `${ENTER_ACTION_PREFIX}${bee.view}`
}

/** Compose the IconProviderRegistry name for a bee's OPEN (offered) icon. */
function openIconNameForBee(bee: VisualBeeDescriptor): string {
  return `${OPEN_ACTION_PREFIX}${bee.view}`
}

/** Compose the IconProviderRegistry name for a bee's ASLEEP icon. */
function asleepIconNameForBee(bee: VisualBeeDescriptor): string {
  return `${ASLEEP_ACTION_PREFIX}${bee.view}`
}

/** Does this tile carry ANY kind the bee answers for, with the behaviour awake
 *  there? A website artifact opens the slides (`alsoKinds`), a retired deck
 *  cell still plays (`legacyKinds`) — the enter icon honours the same list
 *  ViewBee's presence checks and the sideways walk do. */
function carriesAwake(ctx: unknown, label: string, bee: VisualBeeDescriptor): boolean {
  return kindsOf(bee).some(kind => hasDecorationKind(label, kind) && !dormantHere(ctx, kind))
}

/** Does this tile carry ANY kind the bee answers for, awake or not? */
function carriesAny(label: string, bee: VisualBeeDescriptor): boolean {
  return kindsOf(bee).some(kind => hasDecorationKind(label, kind))
}

/** Enablement lens for the sync `visibleWhen` predicates: is this bee's
 *  behavior DORMANT at the tile the overlay is painting? Globally-off (or
 *  publisher-withheld) behaviors disappear for all intents and purposes —
 *  no adopt icon, no enter icon — unless a local wake exception covers the
 *  tile. Reads the cached lens + the live lineage, same shape as
 *  `isPreferredView` below. */
function dormantHere(ctx: unknown, kind: string): boolean {
  const label = String((ctx as { label?: string })?.label ?? '').trim()
  const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
  const here = (lineage?.explorerSegments?.() ?? [])
    .map(segment => String(segment ?? '').trim()).filter(Boolean)
  return isBehaviorDormant(kind, label ? [...here, label] : here)
}

/** Is this the view the tile's own layer opens as — its DEFAULT?
 *
 *  Read from the decoration index, not from a preference map: the default is
 *  a fact about the layer (`view:default`), so the tint, the panel's lit icon
 *  and view.bee's arrival surface are all the same fact. One source, three
 *  readers. */
function isPreferredView(ctx: unknown, view: string): boolean {
  const label = String((ctx as { label?: string })?.label ?? '').trim()
  if (!label) return false
  const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
  const here = (lineage?.explorerSegments?.() ?? [])
    .map(segment => String(segment ?? '').trim()).filter(Boolean)
  return defaultViewForSegments([...here, label]) === view
}

/** Sync the IconProviderRegistry to the current set of adoptable visual
 *  bees. Runs on every VisualBeeRegistry `change` event. Idempotent —
 *  re-adds skip the dup check inside IconProviderRegistry. */
function syncIcons(): void {
  const visualBees = window.ioc.get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  const iconRegistry = window.ioc.get<IconProviderRegistry>(ICON_REGISTRY_KEY)
  if (!visualBees || !iconRegistry) return

  const want = new Set<string>()
  for (const bee of visualBees.adoptable()) {
    const name = iconNameForBee(bee)
    want.add(name)
    if (REGISTERED_ICONS.has(name)) continue
    iconRegistry.add({
      name,
      owner: '@diamondcoreprocessor.com/visual-bee-icons',
      svgMarkup: visualBeeIconSvg(bee.toggleIcon, bee.view),
      profile: ICON_PROFILE,
      hoverTint: VIEW_HOVER_TINT,
      // Same family, quieter: this view is on OFFER here, not present.
      tintWhen: () => VIEW_OFFER_TINT,
      labelKey: bee.labelKey,
      descriptionKey: bee.descriptionKey,
      // Per-tile visibility: surface the icon on tiles that DON'T
      // already have a decoration of this bee's kind. Clicking opts
      // the cell in to the view (runs the bee's slash command), which
      // writes a decoration → kind-index sees the change → icon
      // naturally hides on the next render. Backed by the in-memory
      // index in decoration-kind-index.ts; populated from
      // `decorations:changed` events and `render:cell-count`
      // hydration.
      //
      // For peer-content adoption (only surface icons for views the
      // peer offers at this cell, not all registered views), the
      // predicate would AND against a peer-offered registry populated
      // from peer's layer during swarm-adopt. That requires
      // capturing peer's layer-sig at adoption time — pending.
      visibleWhen: (ctx) => {
        const label = (ctx as { label?: string })?.label
        return typeof label === 'string'
          && !hasDecorationKind(label, bee.decorationKind)
          && !dormantHere(ctx, bee.decorationKind)
      },
    })
    REGISTERED_ICONS.add(name)
  }

  // ENTER icons — the behavior provides its icon on any tile that HAS the
  // view's content (render behaviors only; navigation behaviors have no
  // per-cell content to enter). Shown on the tile's action row across
  // profiles: your own tiles and a peer's (a foreign page still passes
  // through the site-view review gate before mounting). The inverse
  // predicate of the adopt icon above — the two never coexist on one tile.
  for (const bee of visualBees.all()) {
    if (bee.behavior === 'navigation') continue
    const name = enterIconNameForBee(bee)
    want.add(name)
    if (REGISTERED_ICONS.has(name)) continue
    iconRegistry.add({
      name,
      owner: '@diamondcoreprocessor.com/visual-bee-icons',
      svgMarkup: visualBeeIconSvg(bee.toggleIcon, bee.view),
      profiles: ['private', 'public-own', 'public-external'],
      defaultActive: true,
      // A view IS a tile feature: ⋮ reveals it bigger on the feature row —
      // never the always-visible top row. While any feature icon shows, the
      // overlay keeps the delete (danger) row hidden.
      // Enabled views are direct choices on the tile. With several enabled
      // views, each icon remains visible instead of hiding behind the feature
      // expander.
      featureRow: false,
      hoverTint: VIEW_HOVER_TINT,
      // THE DEFAULT wears the accent. Tile bodies still always navigate —
      // but walking in now lands on this view (view.bee's arrival surface),
      // so the accent is a promise about what you are about to see, not just
      // a bookmark. Every other view keeps the family blue, which is what
      // separates a view from an action on the same row.
      tintWhen: (ctx) => isPreferredView(ctx, bee.view) ? VIEW_DEFAULT_TINT : VIEW_TINT,
      labelKey: bee.labelKey,
      descriptionKey: bee.descriptionKey,
      // ANY kind the bee answers for — its own, a further-live peer
      // (`alsoKinds`) or a retired spelling (`legacyKinds`) — as long as the
      // behaviour is awake for that kind here.
      visibleWhen: (ctx) => {
        const label = (ctx as { label?: string })?.label
        return typeof label === 'string' && carriesAwake(ctx, label, bee)
      },
    })
    REGISTERED_ICONS.add(name)
  }

  // OPEN icons — a view OFFERED where its kind is absent, because the bee's
  // own `offersFor(ctx)` says the tile already has the right shape. Same
  // family blue as the enter icon (it is a real door, not an "add"), shown
  // only while the tile lacks every kind the bee answers for (the moment the
  // mark lands, the enter icon takes over) and the behaviour is awake here.
  for (const bee of visualBees.all()) {
    if (bee.behavior === 'navigation' || typeof bee.offersFor !== 'function') continue
    const name = openIconNameForBee(bee)
    want.add(name)
    if (REGISTERED_ICONS.has(name)) continue
    const offers = bee.offersFor
    iconRegistry.add({
      name,
      owner: '@diamondcoreprocessor.com/visual-bee-icons',
      svgMarkup: visualBeeIconSvg(bee.toggleIcon, bee.view),
      profiles: ['private', 'public-own', 'public-external'],
      defaultActive: true,
      featureRow: false,
      hoverTint: VIEW_HOVER_TINT,
      tintWhen: () => VIEW_TINT,
      labelKey: bee.labelKey,
      descriptionKey: bee.descriptionKey,
      visibleWhen: (ctx) => {
        const c = ctx as { label?: string; isBranch?: boolean; hasLink?: boolean; noImage?: boolean; hasNotes?: boolean } | null
        const label = c?.label
        if (typeof label !== 'string' || !label) return false
        if (carriesAny(label, bee) || dormantHere(ctx, bee.decorationKind)) return false
        try {
          return offers({
            label,
            isBranch: c?.isBranch === true,
            hasLink: c?.hasLink === true,
            noImage: c?.noImage === true,
            hasNotes: c?.hasNotes === true,
          }) === true
        } catch { return false }
      },
    })
    REGISTERED_ICONS.add(name)
  }

  // ASLEEP icons — the exact inverse of the enter icon, for TAKEOVER views
  // only: this tile carries the mark, and the behaviour is dormant here, so
  // the hexagon you are looking at is a stand-in. See ASLEEP_ACTION_PREFIX for
  // why no other dormancy earns a mark.
  for (const bee of visualBees.all()) {
    if (bee.behavior === 'navigation' || bee.replacesTileRender !== true) continue
    const name = asleepIconNameForBee(bee)
    want.add(name)
    if (REGISTERED_ICONS.has(name)) continue
    iconRegistry.add({
      name,
      owner: '@diamondcoreprocessor.com/visual-bee-icons',
      svgMarkup: visualBeeIconSvg(bee.toggleIcon, bee.view),
      profiles: ['private', 'public-own', 'public-external'],
      defaultActive: true,
      featureRow: false,
      hoverTint: 0xa8d8ff,
      tintWhen: () => ASLEEP_TINT,
      labelKey: 'features.asleep',
      descriptionKey: 'features.asleep.description',
      visibleWhen: (ctx) => {
        const label = (ctx as { label?: string })?.label
        return typeof label === 'string'
          && hasDecorationKind(label, bee.decorationKind)
          && dormantHere(ctx, bee.decorationKind)
      },
    })
    REGISTERED_ICONS.add(name)
  }

  // Remove icons whose bee was unregistered.
  for (const name of REGISTERED_ICONS) {
    if (want.has(name)) continue
    iconRegistry.remove(name)
    REGISTERED_ICONS.delete(name)
  }
}

/** Dispatch a click on a visual-bee icon — the ADOPT / CREATION door. Three
 *  paths:
 *
 *   1. An ATTACHABLE bee is fully installed by writing its kind at the
 *      tile, so the click emits `feature:apply` for `[...here, label]` —
 *      the one seam the command line's `name@view` and the Beehaviors panel
 *      already use (show-features' #applyFeature is the only writer). It
 *      must NOT fall through to the queen: a view bee's bare command TOGGLES
 *      the view, so the close-up's "Slides" plate used to flip the whole
 *      layer into slides mode instead of marking the tile it was pressed on.
 *
 *   2. Otherwise, if the bee declares a `queenKey`, look up that QueenBee
 *      in IoC and call `invoke(label)` — same as if the user typed
 *      `/<view> <label>` in the command palette. The bee runs locally
 *      and (in the migrated world) writes a decoration via
 *      writeDecoration → cascades the sig into the local
 *      `decorations` slot.
 *
 *   3. If no `queenKey`, broadcast `visual-bee:adopt-request` carrying
 *      the view name + label. The bee's own module can listen for this
 *      and react however it wants (custom-rolled adoption path).
 *
 * The label rides on the tile:action payload — same convention as the
 * built-in tile actions. */
function dispatchViewAction(action: string, label: string | undefined): void {
  const view = action.slice(VIEW_ACTION_PREFIX.length)
  if (!view) return
  const visualBees = window.ioc.get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  const bee = visualBees?.get(view)
  if (!bee) return

  const cell = String(label ?? '').trim()
  if (bee.attachable && cell) {
    const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
    const here = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    EffectBus.emit('feature:apply', { view: bee.view, segments: [...here, cell], remove: false })
    return
  }

  if (bee.queenKey) {
    const queen = window.ioc.get<{ invoke: (args: string) => Promise<void> | void }>(bee.queenKey)
    if (queen?.invoke) {
      void queen.invoke(label ?? '')
      return
    }
  }

  EffectBus.emit('visual-bee:adopt-request', {
    view: bee.view,
    label: label ?? null,
  })
}

type LineageLike = { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }
type ViewModeLike = { mode?: string; setMode?: (next: string) => void }

/** Dispatch a click on an ENTER icon: go to the view's ENTRANCE and open the
 *  view there. Mirrors the websites launch group's activation — navigate
 *  first (synchronous lineage update) so the view renderer captures that
 *  cell as its entry floor when the surface flips.
 *
 *  The entrance is not always the cell that was clicked. A branch-scoped
 *  behaviour (the website) is declared at a ROOT and every descendant is a
 *  member of it, so clicking a member from OUTSIDE the site used to land on a
 *  page-less cell and website mode came up empty — the home page lives at the
 *  root. `resolveViewEntrance` walks up to that root; a node-scoped behaviour
 *  resolves to the clicked cell unchanged. */
function dispatchEnterAction(action: string, label: string | undefined, prefix: string = ENTER_ACTION_PREFIX): void {
  const view = action.slice(prefix.length)
  if (!view || !label) return
  const visualBees = window.ioc.get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  const bee = visualBees?.get(view)
  if (!bee || bee.behavior === 'navigation') return

  const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
  const here = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)

  // In-place views (a slides deck, a lightbox) mount over the CURRENT layer,
  // so closing drops you back on the layer where the icon was clicked. The
  // icon names the exact view; tile-body navigation never enters this path.
  if (bee.opensOnTileClick) {
    // The photo-library icon is the entrance to the image CHOOSER. The
    // lightbox remains a view behaviour, but its tile affordance first lays
    // out the held pictures and background themes as a shaded, selectable
    // layer instead of immediately starting full-screen playback.
    if (bee.view === 'lightbox') {
      EffectBus.emit('images:open', { label, segments: here })
      return
    }
    EffectBus.emit('view:open-for-tile', { view: bee.view, segments: [...here, label] })
    return
  }

  const nav = window.ioc.get<NavigationLike>('@hypercomb.social/Navigation')
  const vm = window.ioc.get<ViewModeLike>('@hypercomb.social/ViewMode')
  if (!nav?.goRaw || !vm?.setMode) return

  // WHERE THIS STEP-IN CAME FROM, announced before the walk erases it. The
  // entrance below is not where the participant was standing — for a
  // branch-scoped behaviour it can be several rings up — so a view that
  // wants to come back out where you came in has to be told now, while
  // "here" still means here. Receivers gate on `view` (see view-spawn.ts);
  // a view that ignores it simply closes onto the entrance as before.
  EffectBus.emit(VIEW_SPAWN_EFFECT, { view: bee.view, mode: (vm.mode ?? '').trim(), segments: here })

  // Async only because the entrance is read from layers; the pair stays
  // ordered (navigate, then flip) so the renderer sees the entrance as its
  // entry floor, exactly as the synchronous path did.
  void resolveViewEntrance(bee, [...here, label]).then(entrance => {
    nav.goRaw!(entrance)
    vm.setMode!(bee.view)
  })
}

/** Dispatch a click on an ASLEEP icon. Entering the view is exactly what it
 *  cannot do — a dormant takeover renders nothing, so the mode would flip and
 *  bounce straight back to the hexagons. Take the participant to where the
 *  answer is instead: the Beehaviors panel, on THIS tile, which is the one
 *  surface that both explains the dormancy and offers the wake. The same
 *  `tile:action` payload the panel's other doors send (ShowFeaturesDrone). */
function dispatchAsleepAction(label: string | undefined): void {
  const cell = String(label ?? '').trim()
  if (!cell) return
  // Out of the `tile:action` dispatch we are standing in: re-emitting the same
  // effect inside its own handler loop re-enters the subscriber set (and
  // rewrites its last value) mid-iteration. A microtask makes it an ordinary
  // second event.
  queueMicrotask(() => EffectBus.emit('tile:action', { action: 'features', label: cell }))
}

// ── Wire up: listen to registry changes + tile:action events ──────────

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.addEventListener('change', () => syncIcons())
    syncIcons() // initial sync — registry may already have bees registered
  },
)

// tile-action dispatcher. Catch every action whose name starts with a
// view-icon prefix and route it through the visual-bee registry. The enter
// check runs first — `view-enter:` must never fall through to the adopt path.
// NOTE: `tile:action` is an EFFECTBUS event (the overlay emits via
// emitEffect), not a window CustomEvent — a window listener never fires.
EffectBus.on<{ action?: string; label?: string }>('tile:action', (detail) => {
  if (!detail?.action) return
  if (detail.action.startsWith(ASLEEP_ACTION_PREFIX)) {
    dispatchAsleepAction(detail.label)
    return
  }
  if (detail.action.startsWith(ENTER_ACTION_PREFIX)) {
    dispatchEnterAction(detail.action, detail.label)
    return
  }
  // An OFFERED view opens through the very same door as a carried one.
  if (detail.action.startsWith(OPEN_ACTION_PREFIX)) {
    dispatchEnterAction(detail.action, detail.label, OPEN_ACTION_PREFIX)
    return
  }
  if (detail.action.startsWith(VIEW_ACTION_PREFIX)) {
    dispatchViewAction(detail.action, detail.label)
  }
})
