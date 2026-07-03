// diamondcoreprocessor.com/presentation/tiles/show-features.drone.ts
//
// "Show features" — the puzzle-piece overlay icon. Click it and this drone
// gathers the META details (NO code) of the bee features the clicked tile
// is using, and emits `features:open` so the shell-side right-docked
// features panel can list them. Clicking another tile's icon ADDS that
// tile's features to the same list (the panel accumulates) — you run
// through the hive collecting features without ever leaving for the
// installer.
//
// ── What counts as a "feature" of a tile ──────────────────────────────
//
// Two sources, unified into one list and each tagged with its ORIGIN:
//
//   1. VISUAL BEES — a decoration kind OWNED by a registered visual bee
//      (VisualBeeRegistry.byDecorationKind). A visual bee IS the render-
//      feature a tile carries (website, dashboard, …). These are node-local
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
// ── Globals (domain-level features) ───────────────────────────────────
//
// Besides tile features, a domain can publish GLOBALS — games and package
// tools with no hive location (see sharing/global-features.ts). They are
// `feature:global` decorations on a domain ROOT: this drone surfaces them on
// the payload (`globals`) when a clicked cell's layer carries them (an
// adopted domain's root, or a peer root in the adopt window), answers the
// panel's Globals tab with YOUR OWN games + public state (`features:globals`),
// and flips the root mark on `features:publish-global`.
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
import { kindsForLabel } from '../../commands/decoration-kind-index.js'
import { featureNeedsReview } from '../../sharing/feature-availability.js'
import {
  GLOBAL_FEATURE_KIND,
  localGlobalTree,
  isGlobalInstalled,
  publishedGlobals,
  setGlobalPublic,
  pathKey,
  type GlobalNode,
} from '../../sharing/global-features.js'
import { writeDropbox } from '../../files/files-attachment.js'
import { parseAccept } from '../../files/file-types.js'
import { WEBSITE_SLOT } from '../../commands/website-slot.js'
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

/** Non-visual cascading CAPABILITIES — behaviors a container declares that
 *  apply to its whole subtree (top-down). Unlike visual bees these don't
 *  RENDER, so they aren't in the VisualBeeRegistry; we describe them here so
 *  the panel can surface them and report where they cascade from. Add new
 *  cascading capability kinds here as they appear. */
const CASCADING_CAPABILITIES: Readonly<Record<string, {
  view: string
  slashCommand: string
  labelKey: string
  descriptionKey: string
  fallbackLabel: string
}>> = {
  'files:dropbox': {
    view: 'dropbox',
    slashCommand: '/dropbox',
    labelKey: 'features.cap.dropbox',
    descriptionKey: 'features.cap.dropbox.desc',
    fallbackLabel: 'File dropbox',
  },
}

/** Where a feature applies to the clicked tile from. */
type Origin = 'direct' | 'cascade'

/** A feature APPLIED to the tile. All strings are pre-resolved (i18n applied
 *  here, where the provider lives) so the panel stays a dumb list. `branchSig`
 *  is the installer-resolvable handle, present only when a peer broadcasts
 *  this tile's branch (direct features only). */
interface FeatureItem {
  view: string
  kind: string
  slashCommand?: string
  behavior?: string
  label: string
  description: string
  branchSig?: string
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
  /** False when this feature belongs to a NOT-YET-ADOPTED peer tile — listed
   *  from the peer's branch root so the participant can see what's on offer.
   *  The panel renders its switch OFF; turning it on is the individual add
   *  (`adopt-feature`), the only moment anything folds or downloads. Absent =
   *  the feature is on the local layer. */
  adopted?: boolean
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
}

/** A feature AVAILABLE to add — registered in the app but not yet on this
 *  tile. The panel lists it with its slash command; rows marked `addable`
 *  carry a live ADD switch (the panel emits `features:enable` and this drone
 *  writes the decoration at the tile's own segments). */
interface AvailableItem {
  view: string
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
}

/** One row of a domain's globals TREE, flattened for the panel — globals are
 *  folders at every level (`games` is a folder, each game a leaf inside it),
 *  and both publish and adopt operate at any level. Name + meta only, inert
 *  by construction: `installed` says a local module answers to a leaf's id
 *  (launchable right now); a missing module arrives only through the
 *  installer's own consent path. */
interface GlobalItem {
  /** Stable row key — the path joined (`games/arkanoid`). */
  key: string
  path: string[]
  /** Indent level (path.length - 1) — the panel renders the tree by inset. */
  depth: number
  folder: boolean
  /** Path tail — a leaf's toggle key (`<id>:toggle` launches it). */
  id: string
  label: string
  icon: string
  installed: boolean
}

/** A row of YOUR OWN globals tree on the panel's Globals tab. */
interface OwnGlobalItem extends GlobalItem {
  /** True when the root carries this node's `feature:global` record. */
  public: boolean
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  /** Features present on this layer (direct + cascaded), each with origin. */
  applied: FeatureItem[]
  /** Features the app knows but this layer doesn't have yet. */
  available: AvailableItem[]
  /** Domain-level globals published on THIS cell's layer (`feature:global`
   *  records) — non-empty only on a domain root (peer or adopted). */
  globals: GlobalItem[]
}

/** Merges globals tree sources (the local tree, published root records, a
 *  peer root's records) into ONE tree and flattens it depth-first for the
 *  panel. First writer of a node keeps its label/icon (the local tree is
 *  added first, so local metadata wins over a stale published record). */
class MergedGlobals {
  #root = new Map<string, MergedNode>()
  #public = new Set<string>()

  add(path: readonly string[], label?: string, icon?: string): void {
    let level = this.#root
    let node: MergedNode | undefined
    for (let i = 1; i <= path.length; i++) {
      const seg = path[i - 1]
      node = level.get(seg)
      if (!node) {
        node = { path: path.slice(0, i), label: seg, icon: 'sports_esports', children: new Map() }
        level.set(seg, node)
        // Metadata applies to the node the caller ADDRESSED; auto-created
        // ancestors keep their segment name until their own record arrives.
        if (i === path.length) {
          if (label) node.label = label
          if (icon) node.icon = icon
        }
      }
      level = node.children
    }
  }

  addTree(nodes: readonly GlobalNode[]): void {
    for (const n of nodes) {
      this.add(n.path, n.label, n.icon)
      this.addTree(n.children)
    }
  }

  markPublic(path: readonly string[]): void {
    this.#public.add(pathKey(path))
  }

  flatten(): OwnGlobalItem[] {
    const out: OwnGlobalItem[] = []
    const walk = (level: Map<string, MergedNode>): boolean => {
      let anyInstalled = false
      for (const node of level.values()) {
        const row: OwnGlobalItem = {
          key: pathKey(node.path),
          path: [...node.path],
          depth: node.path.length - 1,
          folder: node.children.size > 0,
          id: node.path[node.path.length - 1],
          label: node.label,
          icon: node.icon,
          installed: false,
          public: this.#public.has(pathKey(node.path)),
        }
        out.push(row)
        row.installed = node.children.size > 0
          ? walk(node.children)                       // folder: any child installed
          : isGlobalInstalled(row.id)                 // leaf: a module answers
        anyInstalled ||= row.installed
      }
      return anyInstalled
    }
    walk(this.#root)
    return out
  }
}

interface MergedNode {
  path: string[]
  label: string
  icon: string
  children: Map<string, MergedNode>
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
  slashCommand?: string
  behavior?: string
  labelKey?: string
  descriptionKey?: string
  fallbackLabel: string
  cascades: boolean
}

export class ShowFeaturesDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'

  public override description =
    'Gathers the bee-feature metadata (no code) of a clicked tile — both render features and cascading capabilities — and emits features:open so the shell panel lists them, tagging each with its origin (direct on the tile, or cascaded from an ancestor). Read-only — staging the features is benign and handled panel-side.'

  protected override listens: string[] = ['tile:action', 'selection:changed', 'controls:action', 'features:enable', 'features:globals-open', 'features:publish-global']
  protected override emits: string[] = ['features:open', 'features:globals', 'selection:has-features', 'activity:log']

  constructor() {
    super()
    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (String(payload?.action ?? '') !== 'features') return
      const label = String(payload?.label ?? '').trim()
      if (!label) return
      void this.#open(label)
    })

    // The selection context menu mirrors the per-tile puzzle-piece: when the
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
    // single label, so read the selection here and open the panel for each
    // selected tile that actually carries a feature. The viewer upserts one
    // group per tile, so the whole selection shows at once.
    this.onEffect<{ action?: string }>('controls:action', (payload) => {
      if (String(payload?.action ?? '') !== 'features') return
      const selection = this.#ioc()?.get<SelectionLike>(SELECTION_KEY)
      const labels = [...(selection?.selected ?? [])].map(String).filter(Boolean)
      for (const label of labels) {
        if (this.#labelHasFeature(label)) void this.#open(label)
      }
    })

    // The panel's ADD switch on an addable available row. Attaches the feature
    // AT THE TILE'S OWN SEGMENTS (explicit — never "wherever the participant
    // happens to stand", the wrong-target failure the slash route had), then
    // re-opens the group so the row moves into "On this layer".
    this.onEffect<{ cell?: string; segments?: string[]; kind?: string }>('features:enable', (p) => {
      const segments = Array.isArray(p?.segments) ? p!.segments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      const kind = String(p?.kind ?? '')
      if (segments.length === 0 || !kind) return
      void this.#enableAt(segments, kind)
    })

    // The panel's Globals tab asks for YOUR domain's globals (local games +
    // their public state on the root). Also refreshed after every publish
    // toggle and on every panel open — last-value replay keeps a late-mounting
    // panel correct.
    this.onEffect('features:globals-open', () => {
      void this.#emitOwnGlobals()
    })

    // The Globals tab's PUBLIC switch — HIERARCHICAL. ON at a folder marks
    // the folder and everything inside it public; ON at a leaf marks the
    // leaf and its ancestor folders (a leaf's folder is its dependency).
    // OFF withdraws the node's whole subtree and prunes childless folders.
    this.onEffect<{ path?: string[]; on?: boolean }>('features:publish-global', (p) => {
      const path = Array.isArray(p?.path) ? p!.path!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      if (path.length === 0) return
      void this.#publishGlobal(path, p?.on === true)
    })
  }

  /** Flip a node's public state on the hive root, then refresh the tab. */
  async #publishGlobal(path: string[], on: boolean): Promise<void> {
    const key = pathKey(path)
    try {
      await setGlobalPublic(path, on)
      this.emitEffect('activity:log', {
        message: on ? `"${key}" is public on your domain` : `"${key}" withdrawn from your domain`,
        icon: on ? '●' : '○',
      })
    } catch (err) {
      console.warn('[show-features] publish-global failed', { path, on, err })
      this.emitEffect('activity:log', { message: `couldn't update global "${key}"`, icon: '○' })
    }
    await this.#emitOwnGlobals()
  }

  /** YOUR globals tree — the local tree (games folder + leaves) merged with
   *  every `feature:global` node on the root, flattened with depth for the
   *  panel. A published node whose module is gone stays listed (public, not
   *  installed) so it can still be withdrawn. */
  async #emitOwnGlobals(): Promise<void> {
    const merged = new MergedGlobals()
    merged.addTree(localGlobalTree())
    try {
      for (const p of await publishedGlobals()) {
        merged.add(p.path, p.label, p.icon)
        merged.markPublic(p.path)
      }
    } catch { /* store/history not up yet — list the local tree as all-private */ }
    this.emitEffect('features:globals', { globals: merged.flatten() })
  }

  /** Globals rows from a layer's decoration records — the `feature:global`
   *  tree a domain root carries, flattened with depth, each leaf stamped
   *  with whether a local module answers to its id. */
  #globalItems(records: readonly { kind: string; payload?: unknown }[]): GlobalItem[] {
    const merged = new MergedGlobals()
    for (const r of records) {
      if (r.kind !== GLOBAL_FEATURE_KIND) continue
      const p = r.payload as { path?: unknown; id?: unknown; label?: unknown; icon?: unknown } | undefined
      if (!p || typeof p !== 'object') continue
      // Same normalization as publishedGlobals: `path` is the tree shape;
      // a legacy flat record (`{ id }`) reads as `games/<id>`.
      const path = Array.isArray(p.path)
        ? p.path.map(s => String(s ?? '').trim()).filter(Boolean)
        : (typeof p.id === 'string' && p.id ? ['games', p.id] : [])
      if (path.length === 0) continue
      merged.add(
        path,
        typeof p.label === 'string' && p.label.trim() ? p.label.trim() : path[path.length - 1],
        typeof p.icon === 'string' && p.icon ? p.icon : 'sports_esports',
      )
    }
    return merged.flatten().map(({ public: _public, ...row }) => row)
  }

  /** Attach an addable feature at `segments`. Only cascading capabilities are
   *  mechanically attachable today (dropbox — a payload-free decoration);
   *  anything else is refused loudly rather than half-applied. */
  async #enableAt(segments: readonly string[], kind: string): Promise<void> {
    const label = segments[segments.length - 1] ?? ''
    try {
      if (kind === 'files:dropbox') {
        await writeDropbox(segments, parseAccept(''))
        this.emitEffect('activity:log', { message: `dropbox on "${label}"`, icon: '●' })
      } else {
        this.emitEffect('activity:log', { message: `"${kind}" can't be added from the panel — use its command`, icon: '○' })
        return
      }
      if (label) await this.#open(label)   // refresh the panel group in place
    } catch (err) {
      console.warn('[show-features] enable failed', { kind, segments, err })
      this.emitEffect('activity:log', { message: `couldn't add "${kind}" to "${label}"`, icon: '○' })
    }
  }

  #ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

  /** True when this label carries a registered visual-bee feature — the same
   *  honest "has features" signal the per-tile puzzle-piece uses (tile-actions'
   *  tileHasVisualBeeFeature). Synchronous: kindsForLabel is the hot decoration
   *  index and byDecorationKind is a Map walk. */
  #labelHasFeature(label: string): boolean {
    const registry = this.#ioc()?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    if (!registry?.byDecorationKind) return false
    for (const kind of kindsForLabel(label)) {
      if (registry.byDecorationKind(kind)) return true
    }
    return false
  }

  async #open(label: string): Promise<void> {
    const ioc = this.#ioc()
    const registry = ioc?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    if (!registry) return

    const lineage = ioc?.get<LineageLike>(LINEAGE_KEY)
    const parent = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = [...parent, label]

    const branchSig = this.#peerBranchSig(label)
    const i18n = ioc?.get<I18nProvider>(I18N_KEY)

    // ── PEER path: offered on the mesh, NOT yet part of the local layer ──
    // Adopt is a window, not a download: list the branch's features from its
    // ROOT layer alone (one tiny layer fetch + its decoration records — no
    // subtree walk, no fold, no resources). Every row arrives adopted:false
    // with its switch OFF; turning one on is the individual add.
    if (branchSig && !(await this.#isLocalCell(segments))) {
      await this.#openPeer(label, segments, branchSig, registry, i18n)
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
    const directKinds: string[] = [...kindsForLabel(label)]
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
      // UNRECOGNIZED feature kind — a community module's decoration whose bee
      // isn't installed here. Surface it (visual:* kinds only — tags, images
      // and attachments are decorations but not features) so foreign features
      // are never invisible: the row can still be hidden or allowed, and the
      // participant can see WHAT an adopted tile carries before its module
      // arrives. Inert until its module is adopted.
      if (kind.startsWith('visual:') && !appliedViews.has(kind)) {
        appliedViews.add(kind)
        applied.push({
          view: kind,
          kind,
          label: this.#t(i18n, 'features.unknown', kind),
          description: this.#t(i18n, 'features.unknown.desc', ''),
          cascades: false,
          origin: 'direct',
          originSegments: [...segments],
          ...(branchSig ? { branchSig } : {}),
        })
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

    // ── 3. AVAILABLE — every registered feature this layer doesn't have ──
    // The full catalog (visual bees + cascading capabilities) minus what's
    // already applied, so the participant sees what they COULD add here.
    const available = this.#available(registry, appliedViews, i18n)

    // ── 4. GATE STATE — is each direct feature blocked by the community? ──
    // Evaluated with the SAME featureNeedsReview the render gate calls, against
    // the SAME payload sig the renderer would mount, so the panel's "blocked by
    // community" line and the site-view review gate can never disagree.
    await this.#stampGates(applied, segments, records)

    // ── 5. GLOBALS — domain-level features published on this cell's layer ──
    // Non-empty only on a domain root (an adopted domain's folded root, or
    // your own). Name + meta, inert: the panel shows what the domain offers.
    const globals = this.#globalItems(records)

    this.emitEffect<FeaturesOpenPayload>('features:open', { cell: label, segments, applied, available, globals })
    void this.#emitOwnGlobals()   // keep the Globals tab current on every open
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

  /** List a NOT-YET-ADOPTED peer tile's features from its branch ROOT layer
   *  alone — one small layer fetch plus its decoration records. No fold, no
   *  subtree walk, no resource pulls: nothing enters the hive and nothing
   *  heavy downloads until a feature's switch is turned on (`adopt-feature`).
   *  Rows carry `adopted: false` so the panel renders their switches OFF;
   *  `available` is empty (you can't ADD features to a tile you don't hold). */
  async #openPeer(
    label: string,
    segments: readonly string[],
    branchSig: string,
    registry: VisualBeeRegistry,
    i18n: I18nProvider | undefined,
  ): Promise<void> {
    const ioc = this.#ioc()
    const broker = ioc?.get<{ fetchBySig?: (sig: string, type: 'layer' | 'resource' | 'dependency') => Promise<Uint8Array | null> }>(BROKER_KEY)
    const store = ioc?.get<StoreLike>(STORE_KEY)

    let layer: Record<string, unknown> | null = null
    try {
      const bytes = await broker?.fetchBySig?.(branchSig, 'layer')
      if (bytes) layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    } catch { /* unreachable / malformed root — list nothing rather than guess */ }

    const appliedViews = new Set<string>()
    const applied: FeatureItem[] = []
    const pushPeer = (item: FeatureItem): void => {
      item.adopted = false
      applied.push(item)
    }

    // Decoration-borne features on the peer root — plus any `feature:global`
    // marks the publisher put there (the domain's public globals ride the
    // same root layer this path already fetched; zero extra reads).
    const globalRecords: { kind: string; payload?: unknown }[] = []
    const decorations = Array.isArray(layer?.['decorations']) ? layer!['decorations'] as unknown[] : []
    for (const raw of decorations) {
      const sig = String(raw ?? '')
      if (!SIG_RE.test(sig)) continue
      try {
        const blob = await store?.getResource(sig)
        if (!blob) continue
        const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: unknown }
        const kind = typeof rec?.kind === 'string' ? rec.kind : ''
        if (!kind) continue
        if (kind === GLOBAL_FEATURE_KIND) {
          globalRecords.push({ kind, payload: rec.payload })
          continue
        }
        const feature = this.#recognize(kind, registry)
        if (feature) {
          if (appliedViews.has(feature.view)) continue
          appliedViews.add(feature.view)
          pushPeer(this.#describe(feature, kind, i18n, 'direct', undefined, branchSig, segments))
        } else if (kind.startsWith('visual:') && !appliedViews.has(kind)) {
          appliedViews.add(kind)
          pushPeer({
            view: kind,
            kind,
            label: this.#t(i18n, 'features.unknown', kind),
            description: this.#t(i18n, 'features.unknown.desc', ''),
            cascades: false,
            origin: 'direct',
            originSegments: [...segments],
            branchSig,
          })
        }
      } catch { /* unavailable record — skip */ }
    }

    // The website feature may live in the first-class `website` slot instead
    // of a decoration — same read-through order the renderer uses.
    const websiteBee = registry.get('website')
    const slot = layer?.[WEBSITE_SLOT]
    if (websiteBee && Array.isArray(slot) && slot.some(s => SIG_RE.test(String(s)))
        && !appliedViews.has(websiteBee.view)) {
      appliedViews.add(websiteBee.view)
      const feature = this.#recognize(websiteBee.decorationKind, registry)
      if (feature) pushPeer(this.#describe(feature, websiteBee.decorationKind, i18n, 'direct', undefined, branchSig, segments))
    }

    this.emitEffect<FeaturesOpenPayload>('features:open', {
      cell: label,
      segments: [...segments],
      applied,
      available: [],
      globals: this.#globalItems(globalRecords),
    })
    void this.#emitOwnGlobals()
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
      if (appliedViews.has(bee.view) || seen.has(bee.view)) continue
      seen.add(bee.view)
      out.push({
        view: bee.view,
        kind: bee.decorationKind,
        slashCommand: bee.slashCommand,
        label: this.#t(i18n, bee.labelKey, bee.view),
        description: this.#t(i18n, bee.descriptionKey, ''),
        cascades: bee.cascades === true,
      })
    }
    for (const [kind, cap] of Object.entries(CASCADING_CAPABILITIES)) {
      if (appliedViews.has(cap.view) || seen.has(cap.view)) continue
      seen.add(cap.view)
      out.push({
        view: cap.view,
        kind,
        slashCommand: cap.slashCommand,
        label: this.#t(i18n, cap.labelKey, cap.fallbackLabel),
        description: this.#t(i18n, cap.descriptionKey, ''),
        cascades: true,
        // Cascading capabilities attach mechanically (payload-free decoration
        // at the tile's segments) — these rows get the live ADD switch.
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
        slashCommand: bee.slashCommand,
        behavior: bee.behavior,
        labelKey: bee.labelKey,
        descriptionKey: bee.descriptionKey,
        fallbackLabel: bee.view,
        cascades: bee.cascades === true,
      }
    }
    const cap = CASCADING_CAPABILITIES[kind]
    if (cap) {
      return {
        view: cap.view,
        slashCommand: cap.slashCommand,
        labelKey: cap.labelKey,
        descriptionKey: cap.descriptionKey,
        fallbackLabel: cap.fallbackLabel,
        cascades: true,
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
      kind,
      slashCommand: feature.slashCommand,
      behavior: feature.behavior,
      label: this.#t(i18n, feature.labelKey, feature.fallbackLabel),
      description: this.#t(i18n, feature.descriptionKey, ''),
      cascades: feature.cascades,
      origin,
      ...(originCell ? { originCell } : {}),
      ...(originSegments && originSegments.length ? { originSegments: [...originSegments] } : {}),
      ...(branchSig ? { branchSig } : {}),
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
   *  gate evaluates, so #stampGates reads it from here; the raw payload rides
   *  along so #globalItems can read `feature:global` marks without a second
   *  walk. Cold-cache miss → []. */
  async #decorationRecordsAt(segments: readonly string[]): Promise<{ kind: string; payloadSig?: string; payload?: unknown }[]> {
    const ioc = this.#ioc()
    const store = ioc?.get<StoreLike>(STORE_KEY)
    const history = ioc?.get<HistoryLike>(HISTORY_KEY)
    if (!store?.getResource || !history) return []
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig) as { decorations?: unknown } | null
      const slot = layer?.decorations
      if (!Array.isArray(slot)) return []
      const records: { kind: string; payloadSig?: string; payload?: unknown }[] = []
      for (const sig of slot) {
        if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
        try {
          const blob = await store.getResource(sig)
          if (!blob) continue
          const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: unknown }
          if (typeof rec?.kind !== 'string') continue
          records.push({ kind: rec.kind, payloadSig: this.#firstPayloadSig(rec.payload), payload: rec.payload })
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
