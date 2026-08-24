// diamondcoreprocessor.com/presentation/tiles/show-features.drone.ts
//
// "Show features" — the drone behind the Beehaviors panel. Given a LOCATION
// it gathers the META details (NO code) of the bee features there and emits
// `features:open` so the shell-side right-docked panel can list them.
//
// BEHAVIOURS BELONG TO WHERE YOU STAND, so there is no always-on icon on a
// tile: the doors are the top rail's Beehaviors switch, an empty layer
// raising the panel by itself (collection-empty-prompt.drone.ts), the
// selection menu's features button, and the `?features=` URL intent. The one
// PER-TILE door is earned, not standing — the puzzle piece appears on a tile
// that carries a behaviour explicitly created for IT (a view applied here, or
// a kind bound to this location; tile-actions' tileCarriesOwnBehavior), which
// is how a tile added from a swarm shows what it arrived carrying. Every one
// of these arrives here as the same `tile:action` payload.
//
// Beehaviors are managed ONE subject at a time: a new subject REPLACES the
// panel's (its name rides in the panel header) — no accumulation, so you're
// never acting on several tiles at once. The panel also FOLLOWS NAVIGATION:
// while it is open, moving
// through the hive re-targets it to the current location, so behaviors are
// discovered and managed where they apply — go to the place, toggle the
// behavior. Beehaviors are TOGGLES ONLY: tiles are never added, removed, or
// merged from this window (adopt is adopt — SwarmAdoptDrone folds the tiles
// on the adopt click itself).
//
// ── What counts as a "feature" of a tile ──────────────────────────────
//
// Two sources, unified into one list and each tagged with its ORIGIN:
//
//   1. VISUAL BEES — a decoration kind OWNED by a registered visual bee
//      (VisualBeeRegistry.byDecorationKind). A visual bee IS the render-
//      feature a tile carries (website, game, …). These are node-local
//      by default: a website page on a parent does NOT make the child a
//      website. (A community bee may opt into cascade via `cascades: true`.)
//
//   2. CASCADING CAPABILITIES — behaviors a CONTAINER declares that apply to
//      its whole subtree, top-down (see `CASCADING_CAPABILITIES`). Today the
//      one example is the typed file dropbox (`files:dropbox`). These don't
//      render, so they aren't visual bees, but they ARE features that apply
//      to a tile, so we surface them here.
//
// ── Origin: direct vs cascaded ────────────────────────────────────────
//
// For the clicked tile we report WHERE each feature comes from:
//
//   • `direct`  — the decoration is in THIS tile's own `decorations` slot
//                 (a behavior attached to the node itself).
//   • `cascade` — the decoration is in an ANCESTOR's slot and cascades down
//                 to this layer; `originCell` names the ancestor it flows
//                 from (`undefined` when it's declared at the hive root).
//
// We collect the tile's own kinds from the hot in-memory index
// (`kindsForLabel`), then walk the lineage from the nearest ancestor up to
// root reading each ancestor's `decorations` slot. The NEAREST declaration
// wins (a closer dropbox shadows one further up), mirroring
// `DropboxService.#resolve`. Only CASCADING features contribute from
// ancestors — a node-local render on a parent is irrelevant to the child.
//
// ── Staging is benign (panel-side) ────────────────────────────────────
//
// The panel lets the participant "want" a feature. That is BENIGN: nothing
// activates. It only records the feature's branch signature in a hive-local
// staging list (see feature-staging.ts). When the participant later opens
// the installer, portal-overlay hands the staged sigs over and they come
// PRE-TICKED. We surface `branchSig` for DIRECT features — the publisher's
// broadcast layer sig when a peer offers this tile (the same sig the old
// features→installer hand-off passed as `branch=`). Cascaded rows carry no
// branchSig: the installable branch is the ancestor's, not this tile's, so
// they stage as metadata-only (still listed, for provenance).

import { Drone } from '@hypercomb/core'
import type { I18nProvider } from '@hypercomb/core'
import { kindsForLabel, countLabelsWithKind, DEFAULT_VIEW_DECORATION_KIND } from '../../commands/decoration-kind-index.js'
import { defaultViewAt, writeDefaultView, clearDefaultView } from '../../commands/view-default.js'
import { viewSourceScopeAt } from '../../commands/view-source-scope.js'
import { featureNeedsReview } from '../../sharing/feature-availability.js'
import {
  isBehaviorDormant, isKindGloballyOff, readGlobalOffKinds,
  readGlobalOnKinds, seedGlobalOnKinds,
  bindingAt, bindingsFor, isWithdrawnByBinding, allBindings,
  behaviorPath, bindBehaviorTo, unbindBehavior, type BehaviorBinding,
} from '../../sharing/behavior-enablement.js'
import { isWithinAdoptedRoot } from '../../sharing/adopted-roots.js'
import { writeDropbox } from '../../files/files-attachment.js'
import { parseAccept } from '../../files/file-types.js'
import { WEBSITE_SLOT } from '../../commands/website-slot.js'
import { ensureWebsiteBoundAt } from '../../commands/website-binding.js'
import { writeDecoration, listDecorations, removeDecoration, removeDecorationAndWait } from '../../commands/decoration-manifest.js'
import type { VisualBeeRegistry, VisualBeeDescriptor } from '../../commands/visual-bee-registry.js'

const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const I18N_KEY = '@hypercomb.social/I18n'
const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'
const SITE_VIEW_KEY = '@diamondcoreprocessor.com/SiteViewDrone'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'

const SIG_RE = /^[a-f0-9]{64}$/

/** CAPABILITIES — behaviors that are NOT registered visual bees (they have no
 *  view of their own to enter) but ARE features a tile carries. Three flavours:
 *  cascading ones a container declares for its whole subtree (the typed file
 *  dropbox, contacts), node-local content behaviours whose kind is written by
 *  a bee that renders it somewhere ELSE (a slide, played by its parent deck's
 *  slideshow), and build-intent
 *  markers a queen drops for the next generation pass to consume
 *  (`/website here`, `/tutor here`).
 *
 *  Every decoration kind essentials itself reads MUST be declared here or in
 *  the VisualBeeRegistry — an in-house kind reaching the panel as "foreign"
 *  is the bug this table exists to prevent. */
const CAPABILITIES: Readonly<Record<string, {
  view: string
  /** Material Symbols ligature unique to this behavior. */
  icon: string
  slashCommand: string
  labelKey: string
  descriptionKey: string
  fallbackLabel: string
  /** True when declaring it on a container applies it to the whole subtree. */
  cascades: boolean
  /** True when the panel can attach it mechanically (payload-free decoration).
   *  False for capabilities whose payload IS content (a gallery's images) and
   *  for kinds whose attach belongs to their own command (build-intent
   *  markers, `/contact`) — those are never offered in "Available to add". */
  addable: boolean
}>> = {
  'files:dropbox': {
    view: 'dropbox',
    icon: 'upload_file',
    slashCommand: '/dropbox',
    labelKey: 'features.cap.dropbox',
    descriptionKey: 'features.cap.dropbox.desc',
    fallbackLabel: 'File dropbox',
    cascades: true,
    addable: true,
  },
  // Build-intent markers — `/website here` / `/tutor here` queue a cell for
  // the next generation pass, which replaces the marker with the built page
  // or deck. Sub-records of the website/tutor views, not views of their own.
  'visual:website:pending': {
    view: 'website-pending',
    icon: 'language',
    slashCommand: '/website here',
    labelKey: 'features.cap.websitePending',
    descriptionKey: 'features.cap.websitePending.desc',
    fallbackLabel: 'Website page (pending)',
    cascades: false,
    addable: false,
  },
  'visual:tutor:pending': {
    view: 'tutor-pending',
    icon: 'pending_actions',
    slashCommand: '/tutor here',
    labelKey: 'features.cap.tutorPending',
    descriptionKey: 'features.cap.tutorPending.desc',
    fallbackLabel: 'Study deck (pending)',
    cascades: false,
    addable: false,
  },
  // Node-local content behaviours rendered elsewhere: a slide plays in its
  // parent deck's slideshow.
  'visual:diagram:slide': {
    view: 'slide',
    icon: 'crop_landscape',
    slashCommand: '/present slide',
    labelKey: 'features.cap.slide',
    descriptionKey: 'features.cap.slide.desc',
    fallbackLabel: 'Slide',
    cascades: false,
    addable: false,
  },
  // The dropbox flavour: `/contact` places it on a container and
  // ContactService resolves it down the whole subtree.
  'visual:contact:enabled': {
    view: 'contact',
    icon: 'contacts',
    slashCommand: '/contact',
    labelKey: 'features.cap.contact',
    descriptionKey: 'features.cap.contact.desc',
    fallbackLabel: 'Contacts',
    cascades: true,
    addable: false,
  },
}

/** The WAITING record for behaviours whose content is authored later: the
 *  panel's turn-on deposits the same build-intent marker their own
 *  `/website here` / `/tutor here` writes, and the next generation pass
 *  meets it and mints the content. Everything else deposits its own kind
 *  payload-free — the record waits on the objects beneath it, and the
 *  behaviour gives them meaning when they meet (context-behaviors.md). */
const PENDING_FOR: Readonly<Record<string, string>> = {
  'visual:website:page': 'visual:website:pending',
  'visual:tutor:deck': 'visual:tutor:pending',
}

/** Human name for a decoration kind nobody here declares — `visual:x:y` → "Y",
 *  falling back to the module segment, then the whole kind. A foreign
 *  behaviour is still a NAMED behaviour: "unrecognized" is never an identity. */
function nameFromKind(kind: string): string {
  const parts = kind.split(':').filter(Boolean)
  const noun = parts[2] ?? parts[1] ?? kind
  return noun.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase())
}

/** The module segment of a `visual:<module>:<noun>` kind ('' when malformed) —
 *  what the panel names as the module a foreign behaviour is waiting on. */
function moduleFromKind(kind: string): string {
  const parts = kind.split(':').filter(Boolean)
  return parts.length >= 3 ? parts[1] : ''
}

/** Where a feature applies to the clicked tile from. */
type Origin = 'direct' | 'cascade'

/** A feature APPLIED to the tile. All strings are pre-resolved (i18n applied
 *  here, where the provider lives) so the panel stays a dumb list. `branchSig`
 *  is the installer-resolvable handle, present only when a peer broadcasts
 *  this tile's branch (direct features only). */
interface FeatureItem {
  view: string
  /** Material Symbols ligature declared by this behavior. */
  icon: string
  kind: string
  slashCommand?: string
  behavior?: string
  /** True when this feature is a VIEW BEHAVIOUR (a registered visual bee whose
   *  view can be ENTERED — slides, website, home, tutor). The panel offers an
   *  Open action that navigates into the tile and switches to that view.
   *  Absent for cascading capabilities (dropbox) and unrecognized foreign
   *  kinds — there is no view to enter. */
  openable?: boolean
  /** True when opening it mounts the view IN PLACE over the current layer
   *  (no navigation) — so closing returns the participant where they were. */
  opensInPlace?: boolean
  /** True when this behaviour has a REACH to choose — it can read the layer's
   *  own children, or the whole hierarchy beneath. That is the one thing a row
   *  has to MANAGE; every other row has nothing and shows no affordance. */
  manageScopes?: boolean
  /** Which reach it is reading right now. */
  sourceScope?: 'layer' | 'hierarchy'
  /** The bee to ask for a reach change. */
  queenKey?: string
  label: string
  description: string
  branchSig?: string
  /** True when no module here declares this kind — the behaviour is named from
   *  its kind and stays inert until its module arrives. Never "unrecognized":
   *  the row is fully nameable and toggleable meanwhile. */
  foreign?: boolean
  /** The module segment a foreign behaviour is waiting on (`visual:<module>:x`). */
  module?: string
  /** True when this feature, declared on a container, flows to its subtree. */
  cascades: boolean
  /** `direct` = on this tile; `cascade` = inherited from an ancestor. */
  origin: Origin
  /** When `cascade`: the ancestor it flows from (absent = the hive root). */
  originCell?: string
  /** Full hive path of WHERE this feature is attached — the tile itself for
   *  `direct`, or the declaring ancestor for `cascade`. Empty/absent = the hive
   *  root. Surfaced on hover in the panel so you can see the exact location. */
  originSegments?: string[]
  /** For a SCOPE feature (a website): the path of the scope's ROOT — the
   *  outermost ancestor (or the tile itself) declaring the feature. The panel
   *  shows "part of the website at {path}" on descendant rows and offers the
   *  root row the descendant-override reset. */
  scopeSegments?: string[]
  /** Where the row's off-switch writes its hidden record. `node` = at the
   *  tile the panel is describing (scope features: turning off a child page
   *  turns off that page/branch only). Absent/`origin` = at the feature's
   *  attach point (the pre-existing behavior for node-local features). */
  hideAt?: 'node' | 'origin'
  /** True when the verification gate currently BLOCKS this feature from
   *  activating (foreign + not authored + not verified + untrusted domain).
   *  The panel renders the "blocked by community" line + allow override. */
  gated?: boolean
  /** The payload signature the gate evaluates (the page sig for a website) —
   *  the sig the panel's allow override writes to `hc:feature-verified`. */
  gateSig?: string
  /** Publisher domain attributed to the gate sig via the broker's address
   *  graph. Empty/absent = unknown origin. */
  publisherDomain?: string
  /** True when the behavior-enablement lens holds this kind DORMANT here —
   *  globally off on the roster (or withheld by an adopted root's publisher)
   *  with no wake exception covering the tile. The panel renders the switch
   *  off with an "off everywhere" chip and offers "wake here". */
  dormant?: boolean
  /** Set when this behaviour is BOUND to a tile that covers this location —
   *  it belongs HERE in particular, rather than to the hive at large. The
   *  panel marks the row with the tile it belongs to. A row bound to some
   *  OTHER tile never reaches the panel: it is dormant, and dormant means
   *  gone. */
  bound?: BehaviorBinding
}

/** A feature AVAILABLE to add — registered in the app but not yet on this
 *  tile. The panel lists it with its slash command; rows marked `addable`
 *  carry a live ADD switch (the panel emits `features:enable` and this drone
 *  writes the decoration at the tile's own segments). */
interface AvailableItem {
  view: string
  /** Material Symbols ligature declared by this behavior. */
  icon: string
  kind: string
  slashCommand?: string
  label: string
  description: string
  /** True when adding this feature would cascade to the tile's subtree. */
  cascades: boolean
  /** True when the panel can attach this feature mechanically (a cascading
   *  capability with a payload-free decoration, e.g. the dropbox). View bees
   *  are NOT addable here — their slash commands TOGGLE a view; "adding" one
   *  means authoring content (a page, a deck), which no switch can conjure. */
  addable?: boolean
  /** True when this behaviour is a VIEW — a render surface you can be
   *  standing in, as opposed to a capability that quietly applies. Only a
   *  view can be a layer's DEFAULT, so the panel needs the fact on the
   *  available side too (an applied row carries it as `openable`). */
  isView?: boolean
  /** True when this kind is off on the GLOBAL roster, or bound to another
   *  tile — a dormant behavior is not offered for adding (dormant means gone,
   *  not "available"). */
  globalOff?: boolean
  /** Set when this behaviour is bound to a tile covering this location: it is
   *  offered here because this is where it belongs. */
  bound?: BehaviorBinding
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  /** Features present on this layer (direct + cascaded), each with origin. */
  applied: FeatureItem[]
  /** Features the app knows but this layer doesn't have yet. */
  available: AvailableItem[]
  /** True when this location IS an adopted branch root or sits beneath one.
   *  The panel opens such a tile at DIRECT reach — you see the branch as it
   *  arrived, not with your own hive-wide behaviours cascaded over it. */
  adopted?: boolean
  /** The view this layer OPENS AS — its default ('' when it has none). One
   *  per layer; the panel lights that row's icon. */
  defaultView?: string
}

interface TileActionPayload {
  action?: string
  label?: string
}

interface SwarmDroneLike {
  peerTilesAtCurrentSig?: () => readonly ({ name: string } & Record<string, unknown>)[]
  subscribedTiles?: () => readonly ({ name: string } & Record<string, unknown>)[]
}

interface SelectionLike {
  selected?: ReadonlySet<string>
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface StoreLike {
  getResource(sig: string): Promise<Blob | null>
}

interface HistoryLike {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<unknown | null>
}

/** Unified shape resolved from either a visual bee or a cascading capability. */
interface RecognizedFeature {
  view: string
  icon: string
  slashCommand?: string
  behavior?: string
  labelKey?: string
  descriptionKey?: string
  fallbackLabel: string
  cascades: boolean
  /** True for a registered visual bee (an enterable view); false for a
   *  cascading capability (dropbox) — which has no view to open. */
  isVisualBee: boolean
  /** The reaches this view can read its content from. Declaring both is what
   *  gives the row something to MANAGE. */
  sourceScopes?: readonly ('layer' | 'hierarchy')[]
  /** The bee that owns the view's commands — how the panel asks for a reach
   *  change (`scope layer` / `scope hierarchy`). */
  queenKey?: string
  /** True when the view opens IN PLACE over the current layer (no navigation),
   *  the same takeover a click on the tile performs. */
  opensInPlace: boolean
}

export class ShowFeaturesDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'

  public override description =
    'Gathers the bee-feature metadata (no code) of a clicked tile — both render features and cascading capabilities — and emits features:open so the shell panel lists them, tagging each with its origin (direct on the tile, or cascaded from an ancestor). Read-only — staging the features is benign and handled panel-side.'

  protected override listens: string[] = ['tile:action', 'selection:changed', 'controls:action', 'features:enable', 'features:remove', 'features:bind', 'features:default', 'feature:apply', 'features:roster-open']
  protected override emits: string[] = ['features:open', 'selection:has-features', 'activity:log', 'features:outcome', 'features:roster']

  constructor() {
    super()
    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (String(payload?.action ?? '') !== 'features') return
      const label = String(payload?.label ?? '').trim()
      if (!label) return
      // Optional explicit path — the adopt fold passes the TARGET location so
      // the refreshed group reads the tile where it actually landed, which the
      // target picker may have pointed away from the current position.
      const segments = Array.isArray((payload as { segments?: unknown }).segments)
        ? ((payload as { segments: unknown[] }).segments).map(s => String(s ?? '').trim()).filter(Boolean)
        : undefined
      // `root: true` — the subject is the HIVE ROOT itself (the panel follows
      // navigation back to `/`). An explicit EMPTY override reaches #open only
      // through this flag; a plain empty `segments` still means "resolve the
      // label at the current location".
      const root = (payload as { root?: unknown }).root === true
      void this.#open(label, root ? [] : (segments && segments.length ? segments : undefined))
    })

    // The selection context menu is the one PER-TILE door left: when the
    // selection includes a tile that carries a feature, its "features" button
    // appears. Publish that gate on every selection change — last-value replay
    // keeps a late-mounting menu correct. Same shape FileDropDrone uses for
    // `selection:has-documents`.
    this.onEffect<{ selected?: string[] }>('selection:changed', (payload) => {
      const labels = Array.isArray(payload?.selected) ? payload!.selected!.map(String) : []
      const value = labels.some(l => this.#labelHasFeature(l))
      this.emitEffect('selection:has-features', { value })
    })

    // The menu's features button fires `controls:action {features}` — it has no
    // single label, so read the selection here. Beehaviors are managed ONE tile
    // at a time: open the first selected tile that actually carries a feature
    // (the panel replaces its subject, so firing for the whole selection would
    // just race to "last one wins").
    this.onEffect<{ action?: string }>('controls:action', (payload) => {
      if (String(payload?.action ?? '') !== 'features') return
      const selection = this.#ioc()?.get<SelectionLike>(SELECTION_KEY)
      const labels = [...(selection?.selected ?? [])].map(String).filter(Boolean)
      const target = labels.find(l => this.#labelHasFeature(l))
      if (target) void this.#open(target)
    })

    // The panel's ADD switch on an addable available row. Attaches the feature
    // AT THE TILE'S OWN SEGMENTS (explicit — never "wherever the participant
    // happens to stand", the wrong-target failure the slash route had), then
    // re-opens the group so the row moves into "On this layer".
    this.onEffect<{ cell?: string; segments?: string[]; kind?: string }>('features:enable', (p) => {
      const segments = Array.isArray(p?.segments) ? p!.segments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      const kind = String(p?.kind ?? '')
      const cell = String(p?.cell ?? '').trim()
      // Empty segments WITH a named cell = the hive-root group (the panel
      // follows navigation to `/`) — a real target. Empty segments with no
      // cell is still a targetless intent, refused.
      if (!kind || (segments.length === 0 && !cell)) return
      void this.#enableAt(segments, kind, cell)
    })

    // The panel's REMOVE on an applied row. Membership is positive — the
    // decorations ARE the applied behaviors — so removing the tile's records
    // of the kind is the whole off. Answers with `features:outcome` and
    // re-opens the group so the row leaves "on this tile".
    this.onEffect<{ cell?: string; segments?: string[]; kind?: string }>('features:remove', (p) => {
      const segments = Array.isArray(p?.segments) ? p!.segments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      const kind = String(p?.kind ?? '')
      const cell = String(p?.cell ?? '').trim()
      if (!kind || (segments.length === 0 && !cell)) return
      void this.#removeAt(segments, kind, cell)
    })

    // The panel's BELONGS-HERE toggle on an applied row. One tap is the whole
    // gesture: you are standing on the tile, the row is in front of you, and
    // the tap says "this behaviour is this tile's". The panel cannot write the
    // record itself — binding needs the LOCATION SIGNATURE, and only this side
    // has the signer — so the shell states the intent and this drone resolves
    // it, exactly as `features:enable` / `features:remove` already do.
    this.onEffect<{ cell?: string; segments?: string[]; kind?: string; bound?: boolean }>('features:bind', (p) => {
      const segments = Array.isArray(p?.segments) ? p!.segments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      const kind = String(p?.kind ?? '')
      if (!kind || segments.length === 0) return
      void this.#bindAt(segments, kind, p?.bound !== false)
    })

    // The panel's DEFAULT toggle — clicking a view row's ICON. The layer gets
    // one mark saying which view it opens as; clicking the lit one clears it.
    // Same division of labour as the three above: the shell states the
    // intent, this side owns the write.
    this.onEffect<{ cell?: string; segments?: string[]; view?: string; clear?: boolean }>('features:default', (p) => {
      const segments = Array.isArray(p?.segments) ? p!.segments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      const view = String(p?.view ?? '').trim()
      const cell = String(p?.cell ?? '').trim()
      if (segments.length === 0 && !cell) return
      void this.#defaultViewAt(segments, view, p?.clear === true, cell)
    })

    // `name@view` from the command line (`diagram@slides` / `~diagram@slides`).
    // The command line emits this intent and, until now, NOTHING listened — so
    // the attach silently did nothing and the fallback ran the bee's bare slash
    // command, which for a view bee TOGGLES the view (flipping the cell you're
    // standing on into slides) instead of making the TARGET a deck. Attach it
    // properly here, at the target's own segments.
    this.onEffect<{
      view?: string; segments?: string[]; remove?: boolean
      args?: unknown[]; named?: Record<string, unknown>; called?: boolean
    }>('feature:apply', (p) => {
      const view = String(p?.view ?? '')
      const segments = Array.isArray(p?.segments) ? p!.segments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      if (!view || segments.length === 0) return
      // A CALLED attach carries its own content (`meetup@postit("Doors at 7")`)
      // and is authored by the behaviour itself; a bare attach stays the
      // payload-free decoration write it always was.
      if (p?.called === true && p?.remove !== true) {
        void this.#applyCalledFeature(view, segments, p.args ?? [], p.named ?? {})
        return
      }
      void this.#applyFeature(view, segments, p?.remove === true)
    })

    // The GLOBAL ROSTER — the pool of behaviors. No tile subject, no
    // belonging: every behavior the app knows, one light each. Off =
    // dormant everywhere AND withheld from every swarm (one switch, one
    // meaning). Opened pre-swarm from the WORLD stage / join selector, and
    // any time from the panel header. This drone owns the census (registry
    // + CAPABILITIES + lit/off kinds whose module isn't here — those must
    // stay listed or they could never be flipped again).
    this.onEffect('features:roster-open', () => { this.#emitRoster() })

    // Seed the opt-in on-list once the whole module graph has registered —
    // and again before any roster build, whichever comes first. Idempotent.
    setTimeout(() => this.#seedEnablement(), 8000)

  }

  /** Materialize `hc:behavior-global-on` once: the census minus the legacy
   *  off-list, so a hive that predates the opt-in model keeps exactly the
   *  lights it had. From then on the on-list is the truth — a kind it
   *  doesn't name (a new module, a foreign decoration) arrives OFF until
   *  it is lit in the pool. */
  #seedEnablement(): void {
    if (readGlobalOnKinds()) return
    const bees = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)?.all?.() ?? []
    if (bees.length === 0) return   // registry not up yet — the next caller seeds
    seedGlobalOnKinds([
      ...bees.map(b => b.decorationKind),
      ...Object.keys(CAPABILITIES),
      // Bound kinds are ON — binding scopes a behaviour, it never switches
      // it off — so a binding made ahead of its module must stay lit.
      ...Object.keys(allBindings()),
    ])
  }

  /** Build + emit the global roster. Sync — the census is in-memory. */
  #emitRoster(): void {
    this.#seedEnablement()
    const registry = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    const i18n = this.#ioc()?.get<I18nProvider>(I18N_KEY)
    const seen = new Set<string>()
    const rows: Array<{
      view: string; icon: string; kind: string; label: string; description: string
      category: string; slashCommand?: string; foreign?: boolean; module?: string
      on: boolean; used: number
      /** Where this behaviour BELONGS, when it has been bound. The store is
       *  the one surface that must show every binding at once — it is the
       *  census, and a behaviour that is invisible on every tile but one
       *  would otherwise look simply missing. */
      bound?: readonly BehaviorBinding[]
    }> = []
    /** Bindings for a row, omitted entirely when the kind is unbound (the
     *  default — it belongs to the whole hive). */
    const boundOf = (kind: string): { bound?: readonly BehaviorBinding[] } => {
      const bindings = bindingsFor(kind)
      return bindings.length > 0 ? { bound: bindings } : {}
    }
    for (const bee of registry?.all?.() ?? []) {
      if (!bee.decorationKind || seen.has(bee.decorationKind)) continue
      seen.add(bee.decorationKind)
      rows.push({
        view: bee.view,
        icon: bee.toggleIcon || bee.iconName,
        kind: bee.decorationKind,
        label: this.#t(i18n, bee.labelKey, bee.view),
        description: this.#t(i18n, bee.descriptionKey, ''),
        category: bee.behavior || 'view',
        ...(bee.slashCommand ? { slashCommand: bee.slashCommand } : {}),
        on: !isKindGloballyOff(bee.decorationKind),
        used: countLabelsWithKind(bee.decorationKind),
        ...boundOf(bee.decorationKind),
      })
    }
    for (const [kind, cap] of Object.entries(CAPABILITIES)) {
      if (seen.has(kind)) continue
      seen.add(kind)
      rows.push({
        view: cap.view,
        icon: cap.icon,
        kind,
        label: this.#t(i18n, cap.labelKey, cap.fallbackLabel),
        description: this.#t(i18n, cap.descriptionKey, ''),
        category: 'capability',
        ...(cap.slashCommand ? { slashCommand: cap.slashCommand } : {}),
        on: !isKindGloballyOff(kind),
        used: countLabelsWithKind(kind),
        ...boundOf(kind),
      })
    }
    // Kinds nobody here declares but that carry a record — lit or explicitly
    // off on another device, or bound to a tile ahead of their module
    // arriving. Named from the kind, still switchable and still freeable,
    // so no exception can strand itself.
    for (const kind of new Set([
      ...readGlobalOffKinds(),
      ...(readGlobalOnKinds() ?? []),
      ...Object.keys(allBindings()),
    ])) {
      if (seen.has(kind)) continue
      seen.add(kind)
      const moduleName = moduleFromKind(kind)
      rows.push({
        view: kind,
        icon: 'deployed_code_alert',
        kind,
        label: nameFromKind(kind),
        description: this.#t(i18n, 'features.foreign.desc', '').replace('{module}', moduleName || kind),
        category: 'foreign',
        foreign: true,
        ...(moduleName ? { module: moduleName } : {}),
        // A kind reaching this loop only because it is BOUND is still ON —
        // binding scopes a behaviour, it never switches it off.
        on: !isKindGloballyOff(kind),
        used: countLabelsWithKind(kind),
        ...boundOf(kind),
      })
    }
    this.emitEffect('features:roster', { rows })
  }

  /** Attach (or detach) an ATTACHABLE view behaviour at `segments` by writing
   *  its decoration there — the whole install for a behaviour whose content is
   *  simply what the cell already has (a deck plays its children). Bees that
   *  need an authoring pass (a website page, a tutor deck) declare no
   *  `attachable` and are left alone. */
  async #applyFeature(view: string, segments: readonly string[], remove: boolean): Promise<void> {
    const registry = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    const bee = registry?.get?.(view)
    if (!bee?.attachable || !bee.decorationKind) return
    const label = segments[segments.length - 1] ?? ''
    try {
      const existing = await listDecorations({ kind: bee.decorationKind, segments: [...segments] })
      if (remove) {
        for (const e of existing) removeDecoration({ sig: e.sig, segments: [...segments] })
        this.emitEffect('activity:log', { message: `${view} off "${label}"`, icon: '○' })
        return
      }
      if (existing.length === 0) {
        await writeDecoration({
          kind: bee.decorationKind,
          appliesTo: [...segments],
          segments: [...segments],
          payload: bee.toggleIcon ? { icon: bee.toggleIcon } : {},
          mark: 'persistent',
        })
      }
      this.emitEffect('activity:log', { message: `${view} on "${label}"`, icon: '▶' })
    } catch (err) {
      console.warn('[show-features] feature:apply failed', { view, segments, err })
      this.emitEffect('activity:log', { message: `couldn't put ${view} on "${label}"`, icon: '○' })
    }
  }

  /** Turn a behaviour ON for this layer — THE DEPOSIT. Writing its record
   *  here is the whole gesture (context-behaviors.md: "turning a feature on
   *  deposits its record and nothing else"): the record waits on the objects
   *  beneath, and the behaviour gives them meaning when they meet. Bees whose
   *  content is authored later deposit their PENDING marker instead — the
   *  same record their own `/x here` writes, which the next generation pass
   *  turns into the content. Only a kind nobody declares is refused. */
  async #enableAt(segments: readonly string[], kind: string, cellLabel = ''): Promise<void> {
    // Root group: no last segment — the panel's cell name (display-only)
    // keeps the outcome routed back to the row that asked.
    const label = segments[segments.length - 1] ?? cellLabel
    try {
      const bee = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)?.byDecorationKind?.(kind)
      const cap = CAPABILITIES[kind]
      let settleKind = kind
      if (kind === 'files:dropbox') {
        await writeDropbox(segments, parseAccept(''))
        this.emitEffect('activity:log', { message: `dropbox on "${label}"`, icon: '●' })
      } else if (bee || cap) {
        settleKind = PENDING_FOR[kind] ?? kind
        const existing = await listDecorations({ kind: settleKind, segments: [...segments] })
        if (existing.length === 0) {
          await writeDecoration({
            kind: settleKind,
            appliesTo: [...segments],
            segments: [...segments],
            payload: settleKind !== kind
              ? { requestedAt: Date.now() }             // the /x-here marker shape
              : bee?.toggleIcon ? { icon: bee.toggleIcon } : {},
            mark: 'persistent',
          })
        }
        this.emitEffect('activity:log', { message: `${bee?.view ?? cap!.view} on "${label}"`, icon: '▶' })
      } else {
        // Row-level outcome: the refusal lands on the panel row that asked,
        // not only in the transient activity log (the busy switch settles
        // immediately instead of waiting out its leash).
        this.emitEffect('activity:log', { message: `nothing here declares "${kind}" — its module isn't loaded`, icon: '○' })
        this.emitEffect('features:outcome', { cell: label, kind, ok: false, message: `nothing here declares "${kind}" — its module isn't loaded` })
        return
      }
      this.emitEffect('features:outcome', { cell: label, kind, ok: true, message: '' })
      // The decoration write returns as soon as the append is QUEUED — the
      // layer commit rides the committer's FIFO. Refreshing straight away read
      // the pre-commit layer, so the row the participant just switched on came
      // back missing until they re-opened the panel. Wait (briefly, bounded)
      // for the kind to actually be on the layer, then refresh in place.
      await this.#settleKind(segments, settleKind)
      // Refresh THE LAYER WE JUST WROTE — `segments`, always, never the
      // label-at-current-location default. That default is for a tile you
      // HOLD (parent + child); when the subject is the layer you are STANDING
      // ON it appended the label to its own path (`/quiet/quiet`), so the
      // refresh described a phantom child: the deposit was real but the row
      // came back dark, and the second press wrote a decoration at the
      // phantom path just to make the bulb light. One press, one light.
      // ([] = the hive-root group, and an explicit empty array says so.)
      if (label) await this.#open(label, segments)
    } catch (err) {
      console.warn('[show-features] enable failed', { kind, segments, err })
      this.emitEffect('activity:log', { message: `couldn't add "${kind}" to "${label}"`, icon: '○' })
      this.emitEffect('features:outcome', { cell: label, kind, ok: false, message: `couldn't add "${kind}" to "${label}"` })
    }
  }

  /** REMOVE every decoration of `kind` at `segments` — the panel row's ×.
   *  Committed (not just queued) before the refresh so the row is gone when
   *  the group re-reads. A kind with no records here (slot-backed content)
   *  is refused loudly rather than silently un-removed. */
  async #removeAt(segments: readonly string[], kind: string, cellLabel = ''): Promise<void> {
    const label = segments[segments.length - 1] ?? cellLabel
    try {
      const existing = await listDecorations({ kind, segments: [...segments] })
      if (existing.length === 0) {
        this.emitEffect('features:outcome', { cell: label, kind, ok: false, message: `"${kind}" has no record here to remove — use its own command` })
        return
      }
      for (const e of existing) {
        await removeDecorationAndWait({ sig: e.sig, segments: [...segments] })
      }
      this.emitEffect('activity:log', { message: `${kind} off "${label}"`, icon: '○' })
      this.emitEffect('features:outcome', { cell: label, kind, ok: true, message: '' })
      if (label) await this.#open(label, segments)   // refresh the panel group in place
    } catch (err) {
      console.warn('[show-features] remove failed', { kind, segments, err })
      this.emitEffect('activity:log', { message: `couldn't remove "${kind}" from "${label}"`, icon: '○' })
      this.emitEffect('features:outcome', { cell: label, kind, ok: false, message: `couldn't remove "${kind}" from "${label}"` })
    }
  }

  /** A CALLED attach — `meetup@postit("Doors at 7")`.
   *
   *  The content belongs to the behaviour, not to this drone: only the post-it
   *  knows a message becomes a `text` payload, only the slide knows a number
   *  is an index. So a behaviour opts into receiving a call by implementing
   *  `applyCall` on its queen, and this resolves it through the registry's
   *  `queenKey`. Presence of the method IS the declaration — no parallel
   *  capability table to drift out of step with the code.
   *
   *  A behaviour with no `applyCall` is not silently given a bare attach and
   *  a shrug: the participant wrote a message and deserves to hear that this
   *  behaviour has nowhere to put it. */
  async #applyCalledFeature(
    view: string,
    segments: readonly string[],
    args: readonly unknown[],
    named: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const label = segments[segments.length - 1] ?? ''
    const registry = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    const bee = registry?.get?.(view)
    const queenKey = (bee as { queenKey?: string } | undefined)?.queenKey
    const queen = queenKey
      ? this.#ioc()?.get<{ applyCall?: (call: { segments: readonly string[]; args: readonly unknown[]; named: Readonly<Record<string, unknown>> }) => Promise<void> | void }>(queenKey)
      : undefined

    if (!queen?.applyCall) {
      this.emitEffect('activity:log', {
        message: `"${view}" doesn't take a message — attach it plainly, then author it`,
        icon: 'help',
      })
      this.emitEffect('features:outcome', { cell: label, kind: bee?.decorationKind ?? '', ok: false, message: `"${view}" takes no message` })
      return
    }

    try {
      await queen.applyCall({ segments: [...segments], args: [...args], named: { ...named } })
      this.emitEffect('features:outcome', { cell: label, kind: bee?.decorationKind ?? '', ok: true, message: '' })
      await this.#open(label, segments)
    } catch (err) {
      console.warn('[show-features] called attach failed', { view, segments, err })
      this.emitEffect('features:outcome', { cell: label, kind: bee?.decorationKind ?? '', ok: false, message: `couldn't apply "${view}" to "${label}"` })
    }
  }

  /** BIND (or free) `kind` at `segments` — the panel row's belongs-here tap.
   *
   *  The tile's LOCATION signature is the record's identity, and this side owns
   *  the signer, so the resolution happens here rather than in the shell. The
   *  free direction clears the WHOLE binding, not just this location: the tap
   *  reads as "stop belonging to one tile", and leaving a behaviour bound to
   *  some other tile the participant is not standing on would be an invisible
   *  outcome for a visible gesture. */
  async #bindAt(segments: readonly string[], kind: string, bound: boolean): Promise<void> {
    const label = segments[segments.length - 1] ?? ''
    try {
      if (!bound) {
        unbindBehavior(kind)
        this.emitEffect('activity:log', { message: `"${label}" no longer owns this beehavior`, icon: 'link_off' })
        this.emitEffect('features:outcome', { cell: label, kind, ok: true, message: '' })
        await this.#open(label, segments)
        return
      }
      const history = this.#ioc()?.get<HistoryLike>(HISTORY_KEY)
      if (!history?.sign) {
        this.emitEffect('features:outcome', { cell: label, kind, ok: false, message: 'history not ready — try again in a moment' })
        return
      }
      const sig = await history.sign({ explorerSegments: () => [...segments] })
      bindBehaviorTo(kind, { sig, path: behaviorPath(segments), name: label })
      this.emitEffect('activity:log', { message: `this beehavior belongs to "${label}"`, icon: 'link' })
      this.emitEffect('features:outcome', { cell: label, kind, ok: true, message: '' })
      await this.#open(label, segments)
    } catch (err) {
      console.warn('[show-features] bind failed', { kind, segments, bound, err })
      this.emitEffect('features:outcome', { cell: label, kind, ok: false, message: `couldn't ${bound ? 'bind' : 'free'} "${kind}"` })
    }
  }

  /** THE LAYER'S DEFAULT VIEW — "when you come here, open as this."
   *
   *  Mutual exclusivity is the writer's, not ours: `writeDefaultView` uses
   *  `replaceDecoration`, so a layer holds one mark or none and choosing a
   *  second view is the same gesture as choosing the first. */
  async #defaultViewAt(
    segments: readonly string[],
    view: string,
    clear: boolean,
    cellLabel = '',
  ): Promise<void> {
    const label = segments[segments.length - 1] ?? cellLabel
    try {
      if (clear) {
        await clearDefaultView(segments)
        this.emitEffect('activity:log', { message: `"${label}" opens as hexagons again`, icon: '○' })
      } else {
        // Only a REGISTERED RENDER view can be a surface to arrive on. A
        // navigation behaviour opens a lineage rather than a surface, so it
        // has nothing to be the default of.
        const bee = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)?.get?.(view)
        if (!bee || bee.behavior === 'navigation') {
          this.emitEffect('features:outcome', { cell: label, kind: DEFAULT_VIEW_DECORATION_KIND, ok: false, message: `"${view}" isn't a view this layer can open as` })
          return
        }
        await writeDefaultView(segments, view)
        // The append is QUEUED, not committed. Without the wait the refresh
        // below reads the pre-commit layer, answers "no default here", and
        // the icon the participant just lit goes dark again.
        await this.#settleKind(segments, DEFAULT_VIEW_DECORATION_KIND)
        this.emitEffect('activity:log', { message: `"${label}" opens as ${view}`, icon: '▶' })
      }
      this.emitEffect('features:outcome', { cell: label, kind: DEFAULT_VIEW_DECORATION_KIND, ok: true, message: '' })
      // Same rule as the enable above: refresh the layer we wrote, not the
      // label resolved at wherever the participant happens to stand.
      if (label) await this.#open(label, segments)
    } catch (err) {
      console.warn('[show-features] default view failed', { view, segments, clear, err })
      this.emitEffect('features:outcome', { cell: label, kind: DEFAULT_VIEW_DECORATION_KIND, ok: false, message: `couldn't set how "${label}" opens` })
    }
  }

  /** Wait until `kind` is readable on the layer at `segments` — the commit
   *  cascade landing — so a refresh reads the tile as it now IS. Bounded: on
   *  timeout we refresh anyway (the write is queued; the next open is correct)
   *  rather than hanging the switch. */
  async #settleKind(segments: readonly string[], kind: string, timeoutMs = 2500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if ((await this.#decorationKindsAt(segments)).includes(kind)) return
      await new Promise(r => setTimeout(r, 120))
    }
  }

  #ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

  /** True when this label carries a registered visual-bee feature — the
   *  honest "has features" signal the selection menu's button gates on.
   *  Synchronous: kindsForLabel is the hot decoration index and
   *  byDecorationKind is a Map walk. */
  #labelHasFeature(label: string): boolean {
    const registry = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    if (!registry?.byDecorationKind) return false
    for (const kind of kindsForLabel(label)) {
      if (registry.byDecorationKind(kind)) return true
    }
    return false
  }

  async #open(label: string, segmentsOverride?: readonly string[]): Promise<void> {
    const ioc = this.#ioc()
    const registry = ioc?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    if (!registry) return

    // Default: the tile lives at the CURRENT location. An explicit override
    // (the adopt fold's target) wins — the panel must describe the tile where
    // it IS, not where the participant happens to stand. An explicit EMPTY
    // override is the HIVE ROOT (follow-navigation back to `/`): the group's
    // subject is the hive itself, so the label is display-only.
    const lineage = ioc?.get<LineageLike>(LINEAGE_KEY)
    const segments = segmentsOverride
      ? segmentsOverride.map(s => String(s ?? '').trim()).filter(Boolean)
      : [...(lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean), label]
    const isRoot = segments.length === 0
    const parent = segments.slice(0, -1)

    // The root is never a peer branch offer — and its label must not collide
    // with a tile that happens to share the display name.
    const branchSig = isRoot ? undefined : this.#peerBranchSig(label)

    // The root context IS the home page — whatever is active at `/` names
    // the group: the root layer's own name when it carries one, the shell
    // default otherwise. (Named hive roots will resolve the ACTIVE hive's
    // name here when they land.)
    let cell = label
    if (isRoot) {
      const rootLayer = await this.#layerAt(segments)
      const name = String((rootLayer as { name?: unknown } | null)?.name ?? '').trim()
      cell = name || label || 'hypercomb'
    }
    const i18n = ioc?.get<I18nProvider>(I18N_KEY)

    // Behaviors belong to tiles you HOLD. A peer-only offer has nothing local
    // to toggle — and with the adopt button retired, the way to hold it is to
    // WALK IN: visiting a peer tile folds it into your hive (SwarmAdoptDrone's
    // visit handler), after which this panel toggles its behaviors normally.
    if (branchSig && !(await this.#isLocalCell(segments))) {
      this.emitEffect('activity:log', {
        message: i18n?.t('features.visit-first', { cell: label })
          ?? `step into "${label}" first — visiting a tile makes it yours, then its behaviors are yours to switch on`,
        icon: '○',
      })
      return
    }

    // De-dupe by view across both passes: a feature attached directly to the
    // tile shadows the same feature inherited from an ancestor (nearest wins).
    const appliedViews = new Set<string>()
    const applied: FeatureItem[] = []

    // ── 1. DIRECT — features declared on this tile ──
    // UNION of the hot in-memory index and the layer's own `decorations` slot.
    // The hot index alone misses decorations written since the last render
    // walk — a freshly-ADOPTED tile's folded features and a decoration the
    // panel itself just attached (features:enable) both showed as absent until
    // the next repaint. The layer read is authoritative; the index only adds
    // speed, never rows.
    const records = await this.#decorationRecordsAt(segments)
    // At the root the label is display-only — the hot index is keyed by tile
    // label, and consulting it would leak kinds from any tile that shares the
    // hive's display name. The layer read below is the authoritative source.
    const directKinds: string[] = isRoot ? [] : [...kindsForLabel(label)]
    for (const rec of records) {
      if (!directKinds.includes(rec.kind)) directKinds.push(rec.kind)
    }
    for (const kind of directKinds) {
      const feature = this.#recognize(kind, registry)
      if (feature) {
        if (appliedViews.has(feature.view)) continue
        appliedViews.add(feature.view)
        applied.push(this.#describe(feature, kind, i18n, 'direct', undefined, branchSig, segments))
        continue
      }
      // FOREIGN feature kind — a community module's decoration whose bee isn't
      // installed here. It is still a NAMED behaviour: the name comes from the
      // kind itself (`visual:lightbox:gallery` → "Gallery", from the lightbox
      // module) and the missing module is PROVENANCE, not identity. Nothing is
      // ever listed as "unrecognized" — a row you can't name is a row you can't
      // decide about. Surfaced for visual:* kinds only (tags, images and
      // attachments are decorations, not features); inert until its module
      // arrives, and toggleable meanwhile.
      if (kind.startsWith('visual:') && !appliedViews.has(kind)) {
        appliedViews.add(kind)
        const moduleName = moduleFromKind(kind)
        applied.push({
          view: kind,
          icon: 'deployed_code_alert',
          kind,
          label: nameFromKind(kind),
          description: this.#t(i18n, 'features.foreign.desc', '')
            .replace('{module}', moduleName || kind),
          foreign: true,
          ...(moduleName ? { module: moduleName } : {}),
          cascades: false,
          origin: 'direct',
          originSegments: [...segments],
          ...(branchSig ? { branchSig } : {}),
        })
      }
    }

    // ── 1b. SLOT-BASED — a bee whose feature lives in a first-class layer slot
    // (e.g. tutor's `tutor` deck, or a website's `website` slot) rather than a
    // decoration. Mirror ViewBee's slot-OR-decoration gate so slot behaviours
    // are on/off-toggleable in this panel too (they'd otherwise only ever show
    // as "available" with no switch). Keyed by the bee's decorationKind — the
    // same identity the hidden pool records a hide under.
    const slotLayer = await this.#layerAt(segments)
    if (slotLayer) {
      for (const bee of registry.all?.() ?? []) {
        if (!bee.slot || appliedViews.has(bee.view)) continue
        const slotVal = slotLayer[bee.slot]
        if (!Array.isArray(slotVal) || !slotVal.some(s => typeof s === 'string' && SIG_RE.test(s))) continue
        const feature = this.#recognize(bee.decorationKind, registry)
        if (!feature) continue
        appliedViews.add(bee.view)
        applied.push(this.#describe(feature, bee.decorationKind, i18n, 'direct', undefined, branchSig, segments))
      }
    }

    // ── 2. CASCADED — cascading features on an ANCESTOR, nearest → root ──
    // A closer declaration shadows one further up (mirrors DropboxService).
    for (let depth = parent.length; depth >= 0; depth--) {
      const ancestor = parent.slice(0, depth)
      const kinds = await this.#decorationKindsAt(ancestor)
      if (kinds.length === 0) continue
      const from = depth > 0 ? ancestor[depth - 1] : undefined  // undefined = hive root
      for (const kind of kinds) {
        const feature = this.#recognize(kind, registry)
        if (!feature || !feature.cascades || appliedViews.has(feature.view)) continue
        appliedViews.add(feature.view)
        applied.push(this.#describe(feature, kind, i18n, 'cascade', from, undefined, ancestor))
      }
    }

    // ── 2.5 WEBSITE SCOPE — the site this node belongs to ──
    // A website is an APPLICATION SCOPE declared at its root: descendants are
    // part of the site WITHOUT being stamped (never stamp descendants). Walk
    // the lineage OUTERMOST-first; the first ancestor carrying the website
    // feature is the site root. Every website row is `hideAt: 'node'` — its
    // switch acts where you stand (turn a page/branch off by going there),
    // and `scopeSegments` names the site root so the panel can say
    // "part of the website at /root" and offer the root the override reset.
    // A page-less node inside a site still shows the inherited row.
    const websiteBee = registry.get('website')
    if (websiteBee) {
      let scopeRoot: string[] | undefined
      for (let d = 1; d < segments.length; d++) {
        const ancestor = segments.slice(0, d)
        if (await this.#hasWebsiteAt(ancestor, websiteBee.decorationKind)) { scopeRoot = ancestor; break }
      }
      let websiteRow = applied.find(i => i.view === 'website')
      if (!websiteRow && !appliedViews.has('website')) {
        // The direct/decoration passes missed it — a SLOT-ONLY page (the
        // website bee declares no `slot`, so §1b can't see it) or a page-less
        // node inside a site. Probe the node itself, then mint the one row:
        // DIRECT when this node is the scope root, CASCADE from the root
        // otherwise.
        const selfHas = await this.#hasWebsiteAt(segments, websiteBee.decorationKind)
        if (selfHas || scopeRoot) {
          const feature = this.#recognize(websiteBee.decorationKind, registry)
          if (feature) {
            appliedViews.add('website')
            websiteRow = scopeRoot
              ? this.#describe(feature, websiteBee.decorationKind, i18n, 'cascade', scopeRoot[scopeRoot.length - 1], undefined, scopeRoot)
              : this.#describe(feature, websiteBee.decorationKind, i18n, 'direct', undefined, branchSig, segments)
            applied.push(websiteRow)
          }
        }
      }
      if (websiteRow) {
        websiteRow.scopeSegments = [...(scopeRoot ?? segments)]
        websiteRow.hideAt = 'node'
        // WEBSITES BELONG TO A TILE: any site the panel sees — authored,
        // generated, adopted, or legacy — attaches to its root as a
        // behaviour binding (website-binding.ts). Fire-and-forget; the
        // attachment is derived from where the pages live, so this is a
        // recall, never a decision.
        void ensureWebsiteBoundAt(websiteRow.scopeSegments)
      }
    }

    // ── 3. AVAILABLE — every registered feature this layer doesn't have ──
    // The full catalog (visual bees + cascading capabilities) minus what's
    // already applied, so the participant sees what they COULD add here.
    const available = this.#available(registry, appliedViews, i18n)

    // ── 4. GATE STATE — is each direct feature blocked by the community? ──
    // Evaluated with the SAME featureNeedsReview the render gate calls, against
    // the SAME payload sig the renderer would mount, so the panel's "blocked by
    // community" line and the site-view review gate can never disagree.
    await this.#stampGates(applied, segments, records)

    // ── 5. ENABLEMENT — the global-roster lens ──
    // GLOBALLY OFF ⇒ ONLY IN GLOBAL (Jaime, 2026-08-22). A kind held dormant
    // HERE (globally off / publisher-withheld / bound to another tile, no wake
    // covering this tile) is marked and then DROPPED from the tile list by the
    // panel — applied and available alike. The layer list carries two states
    // and no more: lit (deposited here) and dim (not here yet). A dormant row
    // sitting among them was a third, and it read as a behaviour you could
    // switch on from this tile, which is exactly what it is not. The global
    // lens (the store) is the only place a dormant kind appears, and the only
    // place it comes back on. Never re-add an "off everywhere" row here.
    //
    // BINDING is the one that also has something POSITIVE to say. A kind
    // bound to a tile covering this location belongs HERE, so its row carries
    // the binding and the panel marks it as this tile's own — the same record
    // that withdraws it from every other tile is what identifies it on this
    // one.
    for (const row of applied) {
      if (!row.kind) continue
      if (isBehaviorDormant(row.kind, segments)) row.dormant = true
      const binding = bindingAt(row.kind, segments)
      if (binding) row.bound = binding
      // The row's CURRENT reach, for the rows that have one to manage. Read
      // where the record actually sits — a cascade row's declaration lives at
      // its origin, not here.
      if (row.manageScopes) {
        row.sourceScope = await viewSourceScopeAt(row.kind, row.originSegments ?? segments)
      }
    }
    for (const row of available) {
      if (!row.kind) continue
      if (isKindGloballyOff(row.kind) || isWithdrawnByBinding(row.kind, segments)) row.globalOff = true
      else {
        const binding = bindingAt(row.kind, segments)
        if (binding) row.bound = binding
      }
    }

    this.emitEffect<FeaturesOpenPayload>('features:open', {
      cell, segments, applied, available,
      adopted: isWithinAdoptedRoot(segments),
      defaultView: await defaultViewAt(segments),
    })
  }

  /** Does this location's layer carry the website feature — a non-empty
   *  first-class `website` slot, or a `visual:website:page` decoration?
   *  The scope-root probe for the lineage walk above. */
  async #hasWebsiteAt(segments: readonly string[], websiteKind: string): Promise<boolean> {
    const layer = await this.#layerAt(segments)
    if (!layer) return false
    const slot = layer[WEBSITE_SLOT]
    if (Array.isArray(slot) && slot.some(s => typeof s === 'string' && SIG_RE.test(s))) return true
    if (!websiteKind) return false
    return (await this.#decorationKindsAt(segments)).includes(websiteKind)
  }

  /** Does a layer resolve for this exact location — i.e. is the tile part of
   *  the LOCAL hive here (authored or already adopted)? False for a peer-only
   *  mesh tile, which routes #open to the peer listing path. */
  async #isLocalCell(segments: readonly string[]): Promise<boolean> {
    const history = this.#ioc()?.get<HistoryLike>(HISTORY_KEY)
    if (!history) return false
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      return (await history.currentLayerAt(locationSig)) != null
    } catch {
      return false
    }
  }

  /** Stamp `gated` / `gateSig` / `publisherDomain` onto each DIRECT feature.
   *  The website feature gates on the cell's resolved page sig (SiteViewDrone's
   *  three-slot lookup); any other feature gates on its decoration record's
   *  payload sig when it carries one. Features with no payload sig have nothing
   *  to verify and are never marked gated. */
  async #stampGates(
    applied: FeatureItem[],
    segments: readonly string[],
    preloaded?: readonly { kind: string; payloadSig?: string }[],
  ): Promise<void> {
    const ioc = this.#ioc()
    const broker = ioc?.get<{ getKnownDomains?: (s: string) => string[] }>(BROKER_KEY)
    let records: readonly { kind: string; payloadSig?: string }[] | null = preloaded ?? null
    for (const item of applied) {
      if (item.origin !== 'direct') continue
      try {
        let gateSig: string | undefined
        if (item.view === 'website') {
          const siteView = ioc?.get<{ resolvePageSig?: (segs: readonly string[]) => Promise<string | null> }>(SITE_VIEW_KEY)
          gateSig = (await siteView?.resolvePageSig?.(segments)) ?? undefined
        }
        if (!gateSig) {
          records ??= await this.#decorationRecordsAt(segments)
          gateSig = records.find(r => r.kind === item.kind)?.payloadSig
        }
        if (!gateSig) continue
        // EXACT parity with the render gate: site-view's #pagePublisherDomain
        // reads only getKnownDomains(gateSig) — no branch-sig fallback here
        // either, or the panel's "blocked" line and the actual mount gate
        // could disagree (panel unblocked, page still quarantined).
        const domain = broker?.getKnownDomains?.(gateSig)?.[0] ?? ''
        item.gateSig = gateSig
        if (domain) item.publisherDomain = domain
        item.gated = featureNeedsReview(segments, gateSig, domain)
      } catch { /* gate state is advisory in the panel — render gate still enforces */ }
    }
  }

  /** Catalog of features registered in the app but not yet on this layer —
   *  every visual bee plus every cascading capability whose view isn't in
   *  `appliedViews`. */
  #available(
    registry: VisualBeeRegistry,
    appliedViews: ReadonlySet<string>,
    i18n: I18nProvider | undefined,
  ): AvailableItem[] {
    const out: AvailableItem[] = []
    const seen = new Set<string>()
    for (const bee of registry.all?.() ?? []) {
      // A bee whose PENDING marker is already deposited here is on and
      // waiting for the generation pass — not available a second time.
      if (appliedViews.has(bee.view) || appliedViews.has(`${bee.view}-pending`) || seen.has(bee.view)) continue
      seen.add(bee.view)
      out.push({
        view: bee.view,
        icon: bee.toggleIcon || bee.iconName,
        kind: bee.decorationKind,
        slashCommand: bee.slashCommand,
        label: this.#t(i18n, bee.labelKey, bee.view),
        description: this.#t(i18n, bee.descriptionKey, ''),
        cascades: bee.cascades === true,
        // A registered visual bee IS a view — the same fact an applied row
        // carries as `openable`.
        isView: bee.behavior !== 'navigation',
        // Every bee can be turned on here — the on is a DEPOSIT (its own
        // kind payload-free, or its pending marker when the content is
        // authored later), waiting on what's beneath to give it meaning.
        addable: true,
      })
    }
    for (const [kind, cap] of Object.entries(CAPABILITIES)) {
      // Subtree capabilities (dropbox, contacts) are offerable — their on is
      // the same deposit. Sub-records (a slide, a pending marker) are not
      // behaviours of their own and are never offered.
      if (!(cap.addable || cap.cascades) || appliedViews.has(cap.view) || seen.has(cap.view)) continue
      seen.add(cap.view)
      out.push({
        view: cap.view,
        icon: cap.icon,
        kind,
        slashCommand: cap.slashCommand,
        label: this.#t(i18n, cap.labelKey, cap.fallbackLabel),
        description: this.#t(i18n, cap.descriptionKey, ''),
        cascades: cap.cascades,
        // Attaches mechanically (payload-free decoration at the tile's
        // segments) — these rows get the live ADD switch.
        addable: true,
      })
    }
    return out
  }

  /** Resolve an i18n key here (where the provider lives), falling back when
   *  the catalog has no entry. */
  #t(i18n: I18nProvider | undefined, key: string | undefined, fallback: string): string {
    if (!key) return fallback
    const v = i18n?.t?.(key)
    return typeof v === 'string' && v && v !== key ? v : fallback
  }

  /** Resolve a decoration kind to a feature — a registered visual bee, or a
   *  known cascading capability. Returns null for kinds that aren't features
   *  (plain images, individual file attachments, contact cards, …). */
  #recognize(kind: string, registry: VisualBeeRegistry): RecognizedFeature | null {
    const bee: VisualBeeDescriptor | undefined = registry.byDecorationKind?.(kind)
    if (bee) {
      return {
        view: bee.view,
        icon: bee.toggleIcon || bee.iconName,
        slashCommand: bee.slashCommand,
        behavior: bee.behavior,
        labelKey: bee.labelKey,
        descriptionKey: bee.descriptionKey,
        fallbackLabel: bee.view,
        cascades: bee.cascades === true,
        isVisualBee: true,
        opensInPlace: bee.opensOnTileClick === true,
        sourceScopes: bee.sourceScopes,
        queenKey: bee.queenKey,
      }
    }
    const cap = CAPABILITIES[kind]
    if (cap) {
      return {
        view: cap.view,
        icon: cap.icon,
        slashCommand: cap.slashCommand || undefined,
        labelKey: cap.labelKey,
        descriptionKey: cap.descriptionKey,
        fallbackLabel: cap.fallbackLabel,
        cascades: cap.cascades,
        isVisualBee: false,
        opensInPlace: false,
      }
    }
    return null
  }

  /** Build a feature row, resolving the i18n label/description here (fallback
   *  to the view name when no catalog entry). */
  #describe(
    feature: RecognizedFeature,
    kind: string,
    i18n: I18nProvider | undefined,
    origin: Origin,
    originCell: string | undefined,
    branchSig: string | undefined,
    originSegments: readonly string[] | undefined,
  ): FeatureItem {
    return {
      view: feature.view,
      icon: feature.icon,
      kind,
      slashCommand: feature.slashCommand,
      behavior: feature.behavior,
      openable: feature.isVisualBee,
      opensInPlace: feature.opensInPlace,
      ...(feature.sourceScopes?.includes('layer') && feature.sourceScopes.includes('hierarchy')
        ? { manageScopes: true } : {}),
      ...(feature.queenKey ? { queenKey: feature.queenKey } : {}),
      label: this.#t(i18n, feature.labelKey, feature.fallbackLabel),
      description: this.#t(i18n, feature.descriptionKey, ''),
      cascades: feature.cascades,
      origin,
      ...(originCell ? { originCell } : {}),
      ...(originSegments && originSegments.length ? { originSegments: [...originSegments] } : {}),
      ...(branchSig ? { branchSig } : {}),
    }
  }

  /** The raw layer at this exact location — used to detect SLOT-based features
   *  (a bee whose content rides a first-class slot, not a decoration). Cold-cache
   *  miss / unresolved → null. */
  async #layerAt(segments: readonly string[]): Promise<Record<string, unknown> | null> {
    const history = this.#ioc()?.get<HistoryLike>(HISTORY_KEY)
    if (!history) return null
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      return (await history.currentLayerAt(locationSig)) as Record<string, unknown> | null
    } catch {
      return null
    }
  }

  /** Decoration kinds declared AT this exact location, read from its layer's
   *  `decorations` slot. Used to discover cascading features on ancestors
   *  (off-screen, so the hot index doesn't cover them) — mirrors the layer
   *  walk in decoration-kind-index's hydration. Cold-cache miss → []. */
  async #decorationKindsAt(segments: readonly string[]): Promise<string[]> {
    return (await this.#decorationRecordsAt(segments)).map(r => r.kind)
  }

  /** Decoration records AT this exact location — each kind plus the first
   *  64-hex signature found in its payload (the content the record points at,
   *  e.g. a website page's htmlSig). The payload sig is what the verification
   *  gate evaluates, so #stampGates reads it from here. Cold-cache miss → []. */
  async #decorationRecordsAt(segments: readonly string[]): Promise<{ kind: string; payloadSig?: string }[]> {
    const ioc = this.#ioc()
    const store = ioc?.get<StoreLike>(STORE_KEY)
    const history = ioc?.get<HistoryLike>(HISTORY_KEY)
    if (!store?.getResource || !history) return []
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig) as { decorations?: unknown } | null
      const slot = layer?.decorations
      if (!Array.isArray(slot)) return []
      const records: { kind: string; payloadSig?: string }[] = []
      for (const sig of slot) {
        if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
        try {
          const blob = await store.getResource(sig)
          if (!blob) continue
          const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: unknown }
          if (typeof rec?.kind !== 'string') continue
          records.push({ kind: rec.kind, payloadSig: this.#firstPayloadSig(rec.payload) })
        } catch {
          /* malformed / unavailable record — skip */
        }
      }
      return records
    } catch {
      return []
    }
  }

  /** First 64-hex signature reachable in a decoration payload's values —
   *  the record's content pointer (htmlSig, deckSig, …). Undefined when the
   *  payload carries no signature (nothing for the gate to verify). */
  #firstPayloadSig(payload: unknown): string | undefined {
    if (typeof payload === 'string') {
      const s = payload.trim().toLowerCase()
      return SIG_RE.test(s) ? s : undefined
    }
    if (Array.isArray(payload)) {
      for (const v of payload) {
        const found = this.#firstPayloadSig(v)
        if (found) return found
      }
      return undefined
    }
    if (payload && typeof payload === 'object') {
      for (const v of Object.values(payload as Record<string, unknown>)) {
        const found = this.#firstPayloadSig(v)
        if (found) return found
      }
    }
    return undefined
  }

  /** The publisher's broadcast layer sig for this tile, when a live peer
   *  offers it — the installer-resolvable handle the staging hands over.
   *  Checks the current-location cache THEN the subscribed channel, matching
   *  SwarmAdoptDrone's #resolvePeerBranch — otherwise a subscribed leader's
   *  tile resolves for the adopt drone but never shows the panel's adopt
   *  affordances. */
  #peerBranchSig(label: string): string | undefined {
    const swarm = this.#ioc()?.get<SwarmDroneLike>(SWARM_DRONE_KEY)
    if (!swarm?.peerTilesAtCurrentSig) return undefined
    const pools = [swarm.peerTilesAtCurrentSig(), swarm.subscribedTiles?.() ?? []]
    for (const pool of pools) {
      for (const tile of pool) {
        if (tile.name !== label) continue
        const sig = String(tile['layerSig'] ?? '').trim().toLowerCase()
        if (SIG_RE.test(sig)) return sig
      }
    }
    return undefined
  }
}

const _showFeatures = new ShowFeaturesDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ShowFeaturesDrone',
  _showFeatures,
)
