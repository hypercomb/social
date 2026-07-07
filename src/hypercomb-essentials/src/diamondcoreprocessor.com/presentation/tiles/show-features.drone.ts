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

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  /** Features present on this layer (direct + cascaded), each with origin. */
  applied: FeatureItem[]
  /** Features the app knows but this layer doesn't have yet. */
  available: AvailableItem[]
  /** True = the tile exists in the LOCAL layer (held). False = a peer-only
   *  offer; the panel shows the adopt-target row only then. */
  held?: boolean
  /** When a live peer publishes a same-named copy of a HELD tile: the
   *  children each side has that the other doesn't (names). `missing` rows
   *  get an add affordance (merge that child's branch in); `extra` is
   *  informational — a diff view never deletes the participant's content. */
  hierarchy?: { missing: string[]; extra: string[] }
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
  getLayerBySig?(sig: string): Promise<{ name?: string } | null>
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

  protected override listens: string[] = ['tile:action', 'selection:changed', 'controls:action', 'features:enable']
  protected override emits: string[] = ['features:open', 'selection:has-features', 'activity:log']

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
      void this.#open(label, segments && segments.length ? segments : undefined)
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

  async #open(label: string, segmentsOverride?: readonly string[]): Promise<void> {
    const ioc = this.#ioc()
    const registry = ioc?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    if (!registry) return

    // Default: the tile lives at the CURRENT location. An explicit override
    // (the adopt fold's target) wins — the panel must describe the tile where
    // it IS, not where the participant happens to stand.
    const lineage = ioc?.get<LineageLike>(LINEAGE_KEY)
    const segments = segmentsOverride?.length
      ? segmentsOverride.map(s => String(s ?? '').trim()).filter(Boolean)
      : [...(lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean), label]
    const parent = segments.slice(0, -1)

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

    // ── 2.5 PEER DIFF — two people share this tile with different content ──
    // A live publisher offers a same-named copy of this HELD tile. The window
    // is the diff surface: the peer's features NOT on the local copy arrive as
    // adopted:false rows (switch OFF — flipping one MERGES that single feature
    // onto your tile), and `hierarchy` carries the children each side has that
    // the other doesn't. Root-layer reads only — the window stays free; the
    // per-difference click is what downloads. A diff never deletes: `extra`
    // (yours only) is informational.
    let hierarchy: { missing: string[]; extra: string[] } | undefined
    if (branchSig) {
      const peerRoot = await this.#peerRootLayer(branchSig)
      if (peerRoot) {
        for (const rec of await this.#peerFeatureRecords(peerRoot, registry)) {
          const feature = this.#recognize(rec.kind, registry)
          if (feature) {
            if (appliedViews.has(feature.view)) continue
            appliedViews.add(feature.view)
            const item = this.#describe(feature, rec.kind, i18n, 'direct', undefined, branchSig, segments)
            item.adopted = false
            applied.push(item)
          } else if (rec.kind.startsWith('visual:') && !appliedViews.has(rec.kind)) {
            appliedViews.add(rec.kind)
            applied.push({
              view: rec.kind,
              kind: rec.kind,
              label: this.#t(i18n, 'features.unknown', rec.kind),
              description: this.#t(i18n, 'features.unknown.desc', ''),
              cascades: false,
              origin: 'direct',
              originSegments: [...segments],
              branchSig,
              adopted: false,
            })
          }
        }
        hierarchy = await this.#hierarchyDiff(segments, peerRoot)
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

    this.emitEffect<FeaturesOpenPayload>('features:open', {
      cell: label, segments, applied, available, held: true,
      ...(hierarchy && (hierarchy.missing.length || hierarchy.extra.length) ? { hierarchy } : {}),
    })
  }

  /** The peer branch's ROOT layer, fetched through the broker (one small
   *  layer read — local hit or a single HTTP/mesh fetch). Null when
   *  unreachable or malformed. */
  async #peerRootLayer(branchSig: string): Promise<Record<string, unknown> | null> {
    const broker = this.#ioc()?.get<{ fetchBySig?: (sig: string, type: 'layer' | 'resource' | 'dependency') => Promise<Uint8Array | null> }>(BROKER_KEY)
    try {
      const bytes = await broker?.fetchBySig?.(branchSig, 'layer')
      if (!bytes) return null
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  /** Feature kinds carried by a peer root layer: its decoration records plus
   *  a synthetic website record when the first-class `website` slot is
   *  non-empty (the renderer's read-through order). */
  async #peerFeatureRecords(
    layer: Record<string, unknown>,
    registry: VisualBeeRegistry,
  ): Promise<{ kind: string }[]> {
    const store = this.#ioc()?.get<StoreLike>(STORE_KEY)
    const out: { kind: string }[] = []
    const decorations = Array.isArray(layer['decorations']) ? layer['decorations'] as unknown[] : []
    for (const raw of decorations) {
      const sig = String(raw ?? '')
      if (!SIG_RE.test(sig)) continue
      try {
        const blob = await store?.getResource(sig)
        if (!blob) continue
        const rec = JSON.parse(await blob.text()) as { kind?: string }
        if (typeof rec?.kind === 'string' && rec.kind) out.push({ kind: rec.kind })
      } catch { /* unavailable record — skip */ }
    }
    const websiteBee = registry.get('website')
    const slot = layer[WEBSITE_SLOT]
    if (websiteBee?.decorationKind && Array.isArray(slot) && slot.some(s => SIG_RE.test(String(s)))
        && !out.some(r => r.kind === websiteBee.decorationKind)) {
      out.push({ kind: websiteBee.decorationKind })
    }
    return out
  }

  /** Direct-children diff between the LOCAL tile at `segments` and a peer's
   *  root layer. Names resolve via getLayerBySig for local sigs and via the
   *  broker (tiny layer reads, direct children only — never recursive) for
   *  peer sigs the local pool doesn't hold. */
  async #hierarchyDiff(
    segments: readonly string[],
    peerRoot: Record<string, unknown>,
  ): Promise<{ missing: string[]; extra: string[] } | undefined> {
    const ioc = this.#ioc()
    const history = ioc?.get<HistoryLike>(HISTORY_KEY)
    const broker = ioc?.get<{ fetchBySig?: (sig: string, type: 'layer' | 'resource' | 'dependency') => Promise<Uint8Array | null> }>(BROKER_KEY)
    if (!history?.getLayerBySig) return undefined

    const resolveNames = async (children: unknown, peer: boolean): Promise<string[]> => {
      const names: string[] = []
      if (!Array.isArray(children)) return names
      for (const raw of children) {
        const entry = String(raw ?? '').trim()
        if (!entry) continue
        if (!SIG_RE.test(entry)) { names.push(entry); continue }   // literal name
        let layer = await history.getLayerBySig!(entry).catch(() => null)
        if (!layer && peer) {
          try {
            const bytes = await broker?.fetchBySig?.(entry, 'layer')
            if (bytes) layer = JSON.parse(new TextDecoder().decode(bytes)) as { name?: string }
          } catch { /* unreachable child — skip */ }
        }
        const name = typeof layer?.name === 'string' ? layer.name.trim() : ''
        if (name) names.push(name)
      }
      return names
    }

    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const local = await history.currentLayerAt(locationSig) as { children?: unknown } | null
      const localNames = await resolveNames(local?.children, false)
      const peerNames = await resolveNames(peerRoot['children'], true)
      const localSet = new Set(localNames)
      const peerSet = new Set(peerNames)
      const missing = peerNames.filter(n => !localSet.has(n))
      const extra = localNames.filter(n => !peerSet.has(n))
      return { missing, extra }
    } catch {
      return undefined
    }
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

    // Decoration-borne features on the peer root.
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
      held: false,
    })
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
