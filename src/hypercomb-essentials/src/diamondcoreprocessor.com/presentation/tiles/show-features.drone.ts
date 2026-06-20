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
import type { VisualBeeRegistry, VisualBeeDescriptor } from '../../commands/visual-bee-registry.js'

const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const I18N_KEY = '@hypercomb.social/I18n'
const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'

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
}

/** A feature AVAILABLE to add — registered in the app but not yet on this
 *  tile. The panel lists it with its slash command and a benign "like" toggle
 *  (staging) the participant can flag for the installer. */
interface AvailableItem {
  view: string
  kind: string
  slashCommand?: string
  label: string
  description: string
  /** True when adding this feature would cascade to the tile's subtree. */
  cascades: boolean
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  /** Features present on this layer (direct + cascaded), each with origin. */
  applied: FeatureItem[]
  /** Features the app knows but this layer doesn't have yet. */
  available: AvailableItem[]
}

interface TileActionPayload {
  action?: string
  label?: string
}

interface SwarmDroneLike {
  peerTilesAtCurrentSig?: () => readonly ({ name: string } & Record<string, unknown>)[]
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

  protected override listens: string[] = ['tile:action', 'selection:changed', 'controls:action']
  protected override emits: string[] = ['features:open', 'selection:has-features']

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

    // De-dupe by view across both passes: a feature attached directly to the
    // tile shadows the same feature inherited from an ancestor (nearest wins).
    const appliedViews = new Set<string>()
    const applied: FeatureItem[] = []

    // ── 1. DIRECT — features declared on this tile (hot in-memory index) ──
    for (const kind of kindsForLabel(label)) {
      const feature = this.#recognize(kind, registry)
      if (!feature || appliedViews.has(feature.view)) continue
      appliedViews.add(feature.view)
      applied.push(this.#describe(feature, kind, i18n, 'direct', undefined, branchSig))
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
        applied.push(this.#describe(feature, kind, i18n, 'cascade', from, undefined))
      }
    }

    // ── 3. AVAILABLE — every registered feature this layer doesn't have ──
    // The full catalog (visual bees + cascading capabilities) minus what's
    // already applied, so the participant sees what they COULD add here.
    const available = this.#available(registry, appliedViews, i18n)

    this.emitEffect<FeaturesOpenPayload>('features:open', { cell: label, segments, applied, available })
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
      ...(branchSig ? { branchSig } : {}),
    }
  }

  /** Decoration kinds declared AT this exact location, read from its layer's
   *  `decorations` slot. Used to discover cascading features on ancestors
   *  (off-screen, so the hot index doesn't cover them) — mirrors the layer
   *  walk in decoration-kind-index's hydration. Cold-cache miss → []. */
  async #decorationKindsAt(segments: readonly string[]): Promise<string[]> {
    const ioc = this.#ioc()
    const store = ioc?.get<StoreLike>(STORE_KEY)
    const history = ioc?.get<HistoryLike>(HISTORY_KEY)
    if (!store?.getResource || !history) return []
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig) as { decorations?: unknown } | null
      const slot = layer?.decorations
      if (!Array.isArray(slot)) return []
      const kinds: string[] = []
      for (const sig of slot) {
        if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
        try {
          const blob = await store.getResource(sig)
          if (!blob) continue
          const rec = JSON.parse(await blob.text()) as { kind?: string }
          if (typeof rec?.kind === 'string') kinds.push(rec.kind)
        } catch {
          /* malformed / unavailable record — skip */
        }
      }
      return kinds
    } catch {
      return []
    }
  }

  /** The publisher's broadcast layer sig for this tile, when a live peer
   *  offers it — the installer-resolvable handle the staging hands over.
   *  Mirrors tile-actions' peerBroadcastsTile cache read. */
  #peerBranchSig(label: string): string | undefined {
    const swarm = this.#ioc()?.get<SwarmDroneLike>(SWARM_DRONE_KEY)
    if (!swarm?.peerTilesAtCurrentSig) return undefined
    for (const tile of swarm.peerTilesAtCurrentSig()) {
      if (tile.name !== label) continue
      const sig = String(tile['layerSig'] ?? '').trim().toLowerCase()
      if (SIG_RE.test(sig)) return sig
    }
    return undefined
  }
}

const _showFeatures = new ShowFeaturesDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ShowFeaturesDrone',
  _showFeatures,
)
