// pixi/show-cell.drone.ts — the tile renderer's root. It runs the render
// pass and composes the branches drawn out beside it (membership, narrowing,
// order, mesh, readiness, faces, fill geometry —
// documentation/tile-renderer-tree.md). A new tile behaviour
// is a branch of its own, never more lines here.
import { Drone, EffectBus, I18N_IOC_KEY, USAGE_IOC_KEY } from '@hypercomb/core'
import type { I18nProvider, UsageRanker } from '@hypercomb/core'
import { Application, Container, Geometry, Mesh, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { HexLabelAtlas } from '../grid/hex-label.atlas.js'
import { publishOwnedProjection } from './derived-projection-cache.js'
import { resolveLocalResourceReference } from './local-resource-reference.js'
import { HexImageAtlas } from '../grid/hex-image.atlas.js'
import { HexSdfTextureShader } from '../grid/hex-sdf.shader.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY, createHexGeometry } from '../grid/hex-geometry.js'
import { TILE_PROPERTIES_SLOT_DECLARATION, isSignature, readCellProperties, cellLocationSig, readTilePropertiesAt, readTilePropsSigAt, readTilePropsIndex, writeTilePropsIndex, recoverableTileImageSig, seedLayerKeyedEntries } from '../../editor/tile-properties.js'
import { readViewportAt, hasPersistedViewportAt } from '../../editor/viewport-store.js'
import { isWithinAdoptedRoot } from '../../sharing/adopted-roots.js'
import { peerDivergesAt } from '../../sharing/peer-divergence.js'
import { visitRecordAt } from '../../sharing/visit-genome.js'
import { isBehaviorDormant, ENABLEMENT_CHANGED } from '../../sharing/behavior-enablement.js'
import { kindsForLabel, launchShapeForLabel, launchRoleForLabel, launchGroupForLabel, ensureDecorationsIndexed, referenceTargetForLabel, referenceFaceForLabel, titleForLabel, defaultViewWithinSegments, HEXAGONS_SURFACE } from '../../commands/decoration-kind-index.js'
import { defaultViewWithinAt } from '../../commands/view-default.js'
import { getLaneScrollAxis } from '../../sequence/lane-viewport-mode.js'
import { launcherClusterLayout, type ClusterGroup } from './launcher-cluster-layout.js'
import { setTileStacks, type StackVariant } from './tile-stack.js'
import { participantVariantVisual } from './participant-variant.js'
import { hideStorageKey, isCellPublic } from './tile-public.js'
import { sessionHideStore } from './session-hide.store.js'
import type { HistoryService, LayerContent } from '../../history/history.service.js'
import { lineageKey } from '../../history/lineage-key.js'
import type { HistoryCursorService, CursorState } from '../../history/history-cursor.service.js'
import type { ViewportPersistence, ViewportSnapshot } from '../../navigation/zoom/zoom.drone.js'
import { LayoutService } from '../../move/layout.service.js'
import { SubstrateService } from '../../substrate/substrate.service.js'
import { HexLabelAtlasFactory } from '../grid/hex-label.atlas.js'
import { HexSdfTextureShaderFactory } from '../grid/hex-sdf.shader.js'
import { CenterSlotTracker } from '../grid/center-slot-tracker.js'
import { TILE_SOURCE_REGISTRY_KEY, TileSourceRegistry } from './tile-source-registry.js'
import { IndexNurse } from './index.nurse.js'
import { TileNarrowing } from './tile-narrowing.js'
import { resolveChildNames } from './layer-membership.js'
import { TileMesh, type MeshApi } from './tile-mesh.js'
import { CHILD_SHADE, TileReadiness } from './tile-readiness.js'
import { TileFaces } from './tile-faces.js'
import { buildFillQuad, fillKey, type TileLook } from './tile-fill-geometry.js'
import { TileOrder, type ReferenceDraftPreview } from './tile-order.js'
import { adoptPackedVisual, packedVisual, type PackedVisualEntry } from './packed-visuals.js'

// Render-path diagnostics are opt-in (localStorage 'hc:diag' = '1').
// resolveChildNames runs on every non-memoized pass; the per-pass info
// lines below short-circuit on this flag BEFORE their log strings are
// built. Anomaly warns (stale manifest, null sigs, gate exhausted) stay
// unconditional — they fire rarely and have earned their keep.
const DIAG = (() => { try { return localStorage.getItem('hc:diag') === '1' } catch { return false } })()

// The children-readiness shade's switch (CHILD_SHADE) lives with readiness (tile-readiness.ts).

// READINESS SHADE — ON by default (Jaime 2026-08-01: "the tiles don't fade in
// anymore while preloading, this makes it sketchy again — the participant needs
// to know if the tile is ready to be clicked or is still preloading in the
// background"). A preloading tile paints FADED and fades IN over
// SHADE_FADE_MS when its proof lands. It NEVER blocks: the shade is purely
// informational, hover lifts it, and a click on a faded tile still enters
// (front-of-the-line divert) — see tile-overlay #navigateInto.
//
// The fade is deliberately LIGHT (see hex-sdf.shader): the earlier near-black
// treatment had a real failure mode — on a first boot the child-warm queue has
// a long tail, so branch tiles sat dark for a long time and read as "no
// background images at all". A faded tile must still show what it is; only its
// readiness is in question, never its content.
// Escape hatch to turn it off: localStorage 'hc:tile-fade' = '0'. NOTE the key
// changed with the default: profiles that debugged the old opt-in flag still
// carry 'hc:tile-shade' values, and a stale one there would silently suppress
// the fade for exactly the people who have been testing it.
const TILE_SHADE = (() => { try { return localStorage.getItem('hc:tile-fade') !== '0' } catch { return true } })()
/** How long a released tile takes to fade from faded to full. Short enough to
 *  feel like arrival, long enough that the eye catches WHICH tile landed. */
const SHADE_FADE_MS = 280
/** Already-baked label used for the first optimistic frame. The real label's
 *  SDF is rasterized after the commit settles, never in the input frame. */
const PENDING_CELL_LABEL = '\u2026'

// ── THE ARRIVAL GATE ────────────────────────────────────────────────────────
// A layer marked `view:default` opens as a VIEW, not as hexagons — so the
// hexagons must never be the first thing ON SCREEN. The gate ORDERS the
// boot/arrival: it holds this drone's paint until view.bee's verdict
// (`view:arrival`) lands and the surface has flipped, then paints anyway —
// under the covered canvas. The paint is never skipped: the resolved cells
// are the tile roster the deck-shaped views feed on, and the warm mesh is
// what an escape back to hexagons reveals instantly. How long the gate may
// hold before giving up: the verdict rides the same triggers as this
// render, so it normally lands in milliseconds; the timeout only exists so
// a cold read that never resolves strands the participant on their hive,
// not on an empty ink field.
const ARRIVAL_GATE_MS = 2500

/** `#rrggbb` (or bare `rrggbb`) → the [r, g, b] triple in 0–1 the shader
 *  takes, or null if it isn't one. Colours arrive as CSS text (a pheromone
 *  from the registry, a preview border); null, never a guessed colour, so the
 *  caller keeps the last good one instead of flashing a wrong one. */
const previewRgb = (hex: string | null | undefined): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? '').trim())
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : null
}

type Axial = { q: number; r: number }
/** divergence: 0 = current, 1 = future-add (ghost), 2 = future-remove (marked) */
type Cell = { q: number; r: number; label: string; external: boolean; imageSig?: string; heat?: number; hasBranch?: boolean; hasLink?: boolean; hasSubstrate?: boolean; borderColor?: [number, number, number]; divergence?: number; hideText?: boolean; unshared?: boolean; plain?: boolean; pendingProps?: boolean }

/** `tile:preview` — the tile editor's edit in progress (editor/tile-editor.view.ts).
 *  `page` is the page the tile sits on, segments joined with '/'. Pictures are
 *  the exact small pictures a save would write, under their real signatures;
 *  absent means "the stored picture", `removed` means "no picture". */
type TilePreviewPicture = { sig: string; blob: Blob }
type TilePreviewPayload =
  | { label: string; clear: true }
  | { label: string; clear?: false; page: string; point?: TilePreviewPicture | null; flat?: TilePreviewPicture | null; removed?: boolean; border?: string | null; hideText?: boolean }
type TilePreview = Extract<TilePreviewPayload, { page: string }>

/** The rim a tile wears when it names no colour — as #tryInPlaceCellUpdate paints it. */
const PREVIEW_DEFAULT_BORDER: [number, number, number] = [0.784, 0.592, 0.353]

/** One tile of a DIVE (`render:dive`, wave-view): what another layer's tile
 *  needs to be painted HERE, in the page's own slots, by the page's own
 *  shader. Only what the packer reads — everything location-scoped
 *  (selection, shade, peer colour, hidden dimming) belongs to the page
 *  underneath and is deliberately absent. */
export type DiveCell = {
  q: number
  r: number
  label: string
  imageSig?: string
  hasBranch: boolean
  hideText: boolean
  borderColor?: [number, number, number]
  /** A reference tile — hovers with the portal shimmer, as on its own page. */
  portal: boolean
}
type PeerSourceProjection = {
  peerIndex?: number
  peerPubkey?: string
  imageSig?: string
  layerSig?: string
  properties?: Readonly<Record<string, unknown>>
  titles?: Readonly<Record<string, string>>
}
type TileSourceProjection = { name: string; kind: string; source?: PeerSourceProjection }
const tileSourceProjectionKey = (entries: readonly TileSourceProjection[]): string =>
  entries.map(e => [
    e.kind,
    e.name,
    e.source?.peerPubkey ?? '',
    e.source?.layerSig ?? '',
    JSON.stringify(e.source?.properties ?? {}),
    JSON.stringify(e.source?.titles ?? {}),
  ].join(':')).join('|')

/** Launch-group pages live at single-segment ROOT locations named by group id
 *  (/games, /websites, /help, …) — each is its own leaf-only lineage,
 *  addressable directly. Resolved LIVE against the shell's GroupLauncher
 *  registry over IoC at call time (modules must not IMPORT shared — an IoC
 *  read is the sanctioned bridge). Legacy `agg-` locations still count so old
 *  history renders.
 *
 *  `openDirectly` groups are EXCLUDED per the LaunchGroup contract
 *  (group-registry.ts): they have no browsable aggregator page, so /<id> is a
 *  REAL cell page. */
function isLauncherLocation(segs: readonly unknown[]): boolean {
  if (segs.length !== 1 || typeof segs[0] !== 'string') return false
  if (segs[0].startsWith('agg-')) return true
  const reg = (window as any).ioc?.get?.('@hypercomb.social/GroupLauncher') as { get?: (id: string) => { openDirectly?: boolean } | undefined } | undefined
  const group = reg?.get?.(segs[0])
  return !!group && group.openDirectly !== true
}


/** Cold-steel border (126,182,214 → 0..1) for the clustered-help category
 *  TITLE tiles, so a header reads as a header without any new tile shape —
 *  the per-cell borderColor attribute already exists. */
const HEADER_BORDER: [number, number, number] = [0.494, 0.714, 0.839]

/** COLLECTION RIM — the swarm's "which of these are mine now" answer, on
 *  the rim channel so it's unmistakable at a glance (Jaime, 2026-08-20:
 *  "very clear on the fact that we have now included that in our
 *  collection"). Green = acquired from the swarm (the visit genome or an
 *  adopted root covers it); dim slate = witnessed only, not yours yet;
 *  the ordinary gold rim stays for tiles native to your hive. A user-set
 *  border decoration still overrides (applied later in the pass). */
const COLLECTED_BORDER: [number, number, number] = [0.435, 0.827, 0.604]
const WITNESSED_BORDER: [number, number, number] = [0.302, 0.365, 0.447]
/** THE WAND'S TOUCH — the instant the ctrl+press/sweep crosses a witnessed
 *  tile it lights this bright gold rim and lifts out of the armed shade,
 *  ahead of the fold landing; the next render then paints it native with
 *  the COLLECTED green. Prominent by design: taking must read as taking
 *  at the moment of the gesture, not a beat later. */
const WAND_TAKING_BORDER: [number, number, number] = [1.0, 0.83, 0.42]
/** How far a launcher tile may wander while drifting, as a fraction of the hex
 *  circumradius. Small on purpose: the drifted tile must stay inside its home
 *  hex's pointer→axial catchment so clicking the floating tile still opens its
 *  site. The peak offset is √2× this (two summed axes), still well under the
 *  ~0.87·spacing neighbour boundary. */
const LAUNCHER_DRIFT_FRACTION = 0.18



type PixiHostApi = {
  app?: Application | null
  container?: Container | null
}

type SlotsSnapshot = { names: string[]; localCells: Set<string>; branches: Set<string>; mode: 'dense' | 'pinned' }

/**
 * State machine for tile slot ordering — the single source of truth for
 * "which label lives at which index" during incremental updates.
 *
 * Dense mode:  names is a packed array. Remove = splice out. Add = append.
 * Pinned mode: names is sparse with '' gaps to hold slot positions. Remove
 *              replaces with '' (slot preserved). Add returns false — the
 *              LayoutService owns slot assignment, so callers must fall back
 *              to the full render path.
 *
 * Callers never branch on mode — they call remove/add/snapshot and trust
 * the result.
 */
class CellSlots {
  #names: string[] = []
  #local = new Set<string>()
  #branches = new Set<string>()
  #mode: 'dense' | 'pinned' = 'dense'
  #seeded = false

  get seeded(): boolean { return this.#seeded }
  get mode(): 'dense' | 'pinned' { return this.#mode }

  seed(snap: SlotsSnapshot): void {
    this.#names = [...snap.names]
    this.#local = new Set(snap.localCells)
    this.#branches = new Set(snap.branches)
    this.#mode = snap.mode
    this.#seeded = true
  }

  clear(): void {
    this.#seeded = false
    this.#names = []
    this.#local.clear()
    this.#branches.clear()
  }

  snapshot(): SlotsSnapshot {
    return {
      names: [...this.#names],
      localCells: new Set(this.#local),
      branches: new Set(this.#branches),
      mode: this.#mode,
    }
  }

  remove(label: string): void {
    // Preserve slot position in both modes — replacing with '' keeps every other
    // tile's index stable so no tile ever shifts on a neighbouring remove.
    for (let i = 0; i < this.#names.length; i++) {
      if (this.#names[i] === label) this.#names[i] = ''
    }
    this.#local.delete(label)
    this.#branches.delete(label)
  }

  /**
   * Fill the first gap (''), or append at the end. Gaps exist because remove()
   * preserves slot positions — reusing them keeps neighbours still.
   * Pinned mode returns false so LayoutService owns slot assignment.
   */
  add(label: string, hasBranch: boolean): boolean {
    if (this.#mode === 'pinned') return false
    if (!this.#names.includes(label)) {
      const gapIndex = this.#names.indexOf('')
      if (gapIndex >= 0) this.#names[gapIndex] = label
      else this.#names.push(label)
    }
    this.#local.add(label)
    if (hasBranch) this.#branches.add(label)
    return true
  }

  /**
   * Pinned-mode counterpart to add(): place a label at a specific sparse
   * slot the caller already computed (the LayoutService scoring lives in
   * the drone, not here). Grows the backing array with '' gaps as needed.
   * Idempotent when the label is already present. Returns false only if a
   * DIFFERENT label already holds the slot, signalling the caller to fall
   * back to a full render.
   */
  addAt(label: string, index: number, hasBranch: boolean): boolean {
    if (this.#names.includes(label)) {
      this.#local.add(label)
      if (hasBranch) this.#branches.add(label)
      return true
    }
    while (this.#names.length <= index) this.#names.push('')
    if (this.#names[index] !== '' && this.#names[index] !== label) return false
    this.#names[index] = label
    this.#local.add(label)
    if (hasBranch) this.#branches.add(label)
    return true
  }

  /** Mark an already-present label as having a branch. No-op if absent. */
  markBranch(label: string): void {
    if (this.#names.includes(label)) this.#branches.add(label)
  }

  hasBranch(label: string): boolean {
    return this.#branches.has(label)
  }

  has(label: string): boolean {
    return this.#names.includes(label)
  }
}


export class ShowCellDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  /** Render-critical: loaded first so the hexagons paint (the root's criticalBees). */
  readonly lane = 'first-paint'

  public override description =
    'Renders the hex grid — maps cells to coordinates, manages geometry, and syncs with the Nostr mesh.'
  public override effects = ['render', 'network'] as const

  // pixi resources (populated via render:host-ready effect)
  private pixiApp: Application | null = null
  private pixiContainer: Container | null = null
  private pixiRenderer: Application['renderer'] | null = null

  private layer: Container | null = null
  private hexMesh: any | null = null

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    axial: '@diamondcoreprocessor.com/AxialService',
    layout: '@diamondcoreprocessor.com/LayoutService',
  }

  protected override listens = ['render:host-ready', 'tile:saved', 'tile:root-default-changed', 'search:filter', 'render:set-orientation', 'render:grid-changed', 'render:set-pivot', 'mesh:room', 'mesh:secret', 'cell:place-at', 'cell:reorder', 'arrange:preview', 'render:set-gap', 'move:preview', 'clipboard:captured', 'clipboard:verb', 'tags:changed', 'tags:filter', 'tags:indexed', 'takeover:indexed', 'tags:removal-pending', 'tags:apply-pending', 'tags:preview', 'drop:dragging', 'history:cursor-changed', 'tile:toggle-text', 'visibility:show-hidden', 'world:mode', 'tile:public-changed', 'overlay:neon-color', 'translation:tile-start', 'translation:tile-done', 'locale:changed', 'substrate:changed', 'substrate:ready', 'substrate:applied', 'substrate:rerolled', 'cell:added', 'cell:removed', 'cell:mutation-state', 'reference:branch-ready', 'swarm:peers-changed', 'swarm:interest-changed', 'swarm:resource-arrived', 'swarm:hide-changed', 'swarm:filter', 'tile:hidden', 'tile:unhidden', 'content:arrived', 'overlay:band-rows', 'swarm:wand', 'prune:mode-changed', 'landing:quiet', 'landing:apply', 'render:dive', 'render:dive-hover', 'tile:preview', 'view:arrival', 'render:set-hive-visible', 'viewport:persisted', 'feature:hidden', 'feature:restored', 'launcher:reconciled', 'launch:indexed', 'frame:changed', 'frame:offset', 'title:indexed', 'reference:indexed', 'reference:draft-preview', 'fs:changed', 'swarm:divergence-changed', 'mobile:marks-changed', 'render:gather-set', 'tags:required', 'labels:invalidated', 'mesh:public-changed', 'tile-names:dom', 'render:set-text-only', 'spotlight:changed', 'tile:hover']
  protected override emits = ['mesh:ensure-started', 'render:mesh-offset', 'render:tiles-target', 'render:cell-count', 'render:geometry-changed', 'render:tags', 'tile:hover-tags', 'swarm:empty-layer', 'content:missing', 'visual:wanted', 'landing:pending', 'render:dive-painted', 'render:name-visibility', 'navigation:guard-start', 'navigation:guard-end', 'render:gathered', 'render:tile-readiness']
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private atlas: HexLabelAtlas | null = null
  private imageAtlas: HexImageAtlas | null = null
  private atlasRenderer: unknown = null

  /** Sigs with a detached host-fill in flight. Render passes NEVER await
   *  the network (tile creation is a dequeue): a local miss paints
   *  label-only NOW, and the full cascade (memory → OPFS → host,
   *  miss-negative-cached in the Store) runs detached, re-rendering when
   *  the bytes land. This set only prevents stacking duplicate fills for
   *  the same sig while one is in flight. */
  readonly #hostFillInFlight = new Set<string>()

  /** Sigs whose detached host fill CONCLUDED without bytes (miss — the
   *  Store negative-caches it). A sig in here renders bright label-only
   *  (the terminal state) instead of readiness-shaded, so an image that
   *  may never arrive can't leave its tile dimmed and inert forever.
   *  Cleared when a later fill succeeds. */
  readonly #fillMissedSigs = new Set<string>()

  /** Labels rendered SHADED on the last geometry bake — content still
   *  arriving (image or props fetch in flight). Mirrored to
   *  TileOverlayDrone via render:cell-count.shadedLabels so shaded tiles
   *  are inert to clicks; read locally to suppress the hover ring.
   *  Bright means "preloaded — a click lands instantly". */
  readonly #shadedLabels = new Set<string>()

  /** Tiles a take has touched — lifted out of the swarm's standing shade
   *  and stamped with WAND_TAKING_BORDER while their fold lands. Held until
   *  the geometry is rebuilt; by then the landed fold paints them native. */
  readonly #wandTakingLabels = new Set<string>()

  /** The hideText tile currently under the pointer, if any. A tile that
   *  hides its name gets it back for as long as it is hovered — nothing
   *  else about the tile changes, and no other tile is touched. The reveal
   *  is purely a label-UV flip (see #setHoverReveal), so the text returns
   *  in its normal place with its normal backing band. */
  #hoverRevealLabel: string | null = null

  /** Last resolved TileSourceRegistry entries per location key — the
   *  fallback a render pass uses when source resolution exceeds its
   *  budget (see the bounded resolve in the render path). */
  readonly #sourceEntriesCache = new Map<string, readonly TileSourceProjection[]>()

  /** Budget for awaited tile-source resolution per render pass. Local
   *  sources answer in single-digit ms; anything slower (a source mid
   *  network cascade) renders from the cached entries and catches up via
   *  a detached re-render. */
  static readonly SOURCE_RESOLVE_BUDGET_MS = 250
  /** Publisher image sigs from TileSourceRegistry entries (config/snapshot
   *  sources, e.g. DCP-adopted branches mounted in SOLO). Fallback source
   *  for external cells when no live swarm publisher is present. */
  private readonly registryImageByLabel = new Map<string, string>()
  /** Full sanitized projection for whichever external/spotlit participant is
   *  currently painting this identity. Images are only one field in it. */
  private readonly registryPropertiesByLabel = new Map<string, Readonly<Record<string, unknown>>>()
  /** Display titles for the selected participant variant. The map key remains
   *  the fixed identity name, so changing this text never splits a stack. */
  private readonly registryTitlesByLabel = new Map<string, Readonly<Record<string, string>>>()
  /** What each tile shows — its picture and its properties' facts, cached by
   *  label for the location in view (tile-faces.ts). */
  readonly #faces: TileFaces = new TileFaces({
    imageAtlas: () => this.imageAtlas,
    flat: () => this.#flat,
    hostFillInFlight: this.#hostFillInFlight,
    fillMissed: this.#fillMissedSigs,
    armMissWindow: sigs => this.#armMissWindowRetry(sigs),
    repaint: () => { this.#forceNextRender = true; this.requestRender() },
    parentOf: label => this.#narrow.parentOf(label),
    cursorPropsOverride: () => this.#cursorPropsOverride,
    registryProperties: label => this.registryPropertiesByLabel.get(label),
    registryImage: label => this.registryImageByLabel.get(label),
    renderedCells: () => this.renderedCells.values(),
    previewSigs: () => this.#tilePreviewSigs(),
    emit: (effect, payload) => this.emitEffect(effect, payload),
    onCleared: () => {
      // A REPLACED atlas restarts its eviction counter at 0, so a remembered
      // generation of 0 would read as "already applied" against a brand-new,
      // empty atlas and hold the early-return over an unbaked grid. -1 is never
      // a live generation, so the next pass always rebuilds.
      this.#bakedImageAtlasGen = -1
      this.#bakedLabelAtlasGen = -1
    },
  })

  private listening = false
  private rendering = false
  private renderQueued = false

  private renderedCellsKey = ''
  private renderedCount = 0

  // The atlas eviction generations the CURRENT geometry buffer was baked
  // against. Held BESIDE the cells key, never inside it — that is the whole
  // point of the pair.
  //
  // A generation bump means "baked UVs in the buffer may now point at a slot
  // that was wiped or handed to another label", and the only cure is a
  // geometry rebuild (applyGeometry re-bakes and re-points every cell). While
  // the generations lived inside buildCellsKey, the in-place fast paths —
  // #repaintReadinessInPlace and #tryInPlaceCellUpdate, which recompute the
  // WHOLE key after touching one attribute — ADOPTED a bump they had not
  // acted on. The pending pass then found its key unchanged, took the
  // early-return below, and the wiped slots were never re-baked: those tiles
  // kept their label BAND with no name inside it (the shader gates the band
  // on the UV rect, which is still valid — only the pixels behind it are
  // gone). Same swallow for a retitle's invalidateLabel and for a pivot flip.
  //
  // Only applyGeometry's success path may write these. -1 = nothing baked yet.
  #bakedImageAtlasGen = -1
  #bakedLabelAtlasGen = -1

  // Complete child membership, memoized by the PARENT layer's content sig:
  // names + the subset that are branches (have their own children). Only a
  // COMPLETE resolution is stored, so a warm re-render reads the full set —
  // names AND branch-status — with ZERO per-child lookups, and a partial can
  // never be cached. The parent's content sig is the perfect key: the child
  // set cannot change without the sig changing, so an entry stays valid until
  // the layer itself does. This is the "optimize once, read until the list
  // changes" pattern — safe only because we gate on completeness before
  // writing here.
  readonly #completeChildNamesByParentSig = new Map<string, { names: string[]; branches: string[] }>()

  /** How many prepared views to keep. Was 256 — smaller than the number of
   *  locations a single neighbourhood warm prepares (512 nodes), so the memo
   *  evicted views WHILE the preloader was still filling it and the same
   *  resolutions were paid again on the next visit. An entry is a short array
   *  of names keyed by an immutable content sig; keeping thousands costs a
   *  rounding error of memory and is the difference between "preloaded once"
   *  and "preloaded forever". */
  static readonly #PREPARED_VIEW_CAP = 4096

  /** Prepared-view sig → the location segments it was prepared for, joined.
   *  Exists so an add/remove can invalidate the ANCESTOR entries it actually
   *  affects instead of dropping every prepared view in the session (which is
   *  what "click a tile, come back, and it's slow again" was made of). */
  readonly #preparedViewPath = new Map<string, string>()

  /** MEMBERSHIP GENERATION — the fence on every memo write.
   *
   *  Bumped by every add/remove that invalidates prepared views. A resolution
   *  pass captures it before its first await and refuses to write its memo if
   *  it moved: a pass that started BEFORE a child was appended (a neighbourhood
   *  warm, a render mid-flight) otherwise landed its pre-add answer AFTER the
   *  invalidation and served "leaf" for a tile that had just become a branch —
   *  the holder a References composition wrote could not be clicked into until
   *  a reload. The fence is what makes the invalidation final. */
  #membershipGeneration = 0

  /** Drop prepared views whose location is an ancestor of (or equal to) the
   *  segments where a child was just added or removed — those are the only
   *  entries whose branch-status can have flipped. Everything else keeps its
   *  preparation. Unknown segments fall back to the old blanket clear, which
   *  is correct, just wasteful (legacy emitters that don't carry an address). */
  #invalidatePreparedViewsFor(segments: readonly string[] | undefined): void {
    this.#membershipGeneration++
    if (!segments || segments.length === 0) {
      this.#completeChildNamesByParentSig.clear()
      this.#preparedViewPath.clear()
      return
    }
    const path = segments.join('/')
    for (const [sig, prepared] of [...this.#preparedViewPath]) {
      // Ancestor-or-self: '' (root) is an ancestor of everything.
      if (prepared === '' || path === prepared || path.startsWith(prepared + '/')) {
        this.#completeChildNamesByParentSig.delete(sig)
        this.#preparedViewPath.delete(sig)
      }
    }
    // Entries with no recorded path predate the index — drop those, they are
    // the only ones we cannot reason about.
    for (const sig of this.#completeChildNamesByParentSig.keys()) {
      if (!this.#preparedViewPath.has(sig)) this.#completeChildNamesByParentSig.delete(sig)
    }
  }
  // Keep the promise, not only a flag: the history warmer and visible
  // readiness pass often reach the same target together. Joining that work
  // lets both callers observe the completed first-paint snapshot.
  readonly #viewPrepInFlight = new Map<string, Promise<boolean>>()
  // The tile under the pointer, shown opaque while hovered (never proof).
  #hoverOpaqueLabel: string | null = null
  /** Is the inside of each branch tile ready — the verdict, its memo, and the
   *  warm and bake work that earns it (tile-readiness.ts). */
  readonly #readiness: TileReadiness = new TileReadiness({
    imageAtlas: () => this.imageAtlas,
    labelAtlas: () => this.atlas,
    flat: () => this.#flat,
    fillMissed: this.#fillMissedSigs,
    hostFillInFlight: this.#hostFillInFlight,
    preparedNames: headSig => this.#completeChildNamesByParentSig.get(headSig)?.names,
    preparedCells: locationKey => this.#layerCellsCache.get(locationKey)?.cells,
    prepareView: (headSig, segments) => this.prepareView(headSig, segments),
    decode: sig => this.#faces.decode(sig),
    renderedCells: () => this.renderedCells.values(),
    paintShade: label => { this.#writeShadeFor(label) },
    released: label => {
      this.#writeShadeFor(label)
      this.#shadedLabels.delete(label)
      this.emitEffect('render:tile-readiness', { shadedLabels: this.#preloadingLabels() })
    },
    revoked: label => {
      this.#shadeFadeStartedAt.delete(label)
      this.#writeShadeFor(label)
      this.emitEffect('render:tile-readiness', { shadedLabels: this.#preloadingLabels() })
    },
    emitReadiness: () => this.emitEffect('render:tile-readiness', { shadedLabels: this.#preloadingLabels() }),
    scheduleRepaint: () => this.#scheduleReadinessRepaint(),
  })
  // Below this, a raw source decodes in ~a millisecond anyway — deriving a
  // cell-sized copy would spend the optimize phase on images with nothing
  // to gain. Byte size is a heuristic for pixel count, deliberately loose.
  static readonly #VISUAL_DEMAND_MIN_BYTES = 24_576
  #readinessRepaintTimer: ReturnType<typeof setTimeout> | null = null
  // Per-gate-key count of consecutive INCOMPLETE child resolutions. Bounds
  // the completeness gate so a genuinely-absent child (corrupt / deleted /
  // never-synced) can't hold the canvas blank forever — after the budget
  // the render paints best-effort.
  readonly #incompleteResolveAttempts = new Map<string, number>()
  // Gate keys (parent content sig) that exhausted the retry budget. Once a
  // layer is declared unresolvable it paints best-effort and stops gating,
  // so a permanently-missing child can't thrash the render loop. A new
  // parent sig (content changed) gates fresh.
  readonly #resolveGateExhausted = new Set<string>()
  static readonly #RESOLVE_GATE_MAX_ATTEMPTS = 12
  // Wall-clock deadline for a completeness hold, keyed by LOCATION.
  //
  // The attempt budget above cannot bound anything by itself. It is keyed by
  // parent content sig, so a parent whose head advances between passes gets a
  // fresh key and restarts at attempt 1 — and `#rearmResolveGates`
  // (content:arrived / miss-window) CLEARS the counter outright. Either path
  // lets a layer defer the paint forever, which is the blank canvas the
  // budget exists to prevent. The location key does not churn and this map
  // survives the re-arm, so however the counter is reset the paint is still
  // only held for #RESOLVE_GATE_HOLD_MS before falling through to
  // best-effort.
  readonly #gateFirstHoldAt = new Map<string, number>()
  static readonly #RESOLVE_GATE_HOLD_MS = 8000
  // Per-parent-sig count of consecutive renders whose branch-STATUS (does a
  // child have its own children?) came back on a cold pool miss. Unlike the
  // name gate this NEVER holds the paint — tiles show immediately — it only
  // schedules a bounded re-render so a branch dot that was cold at first paint
  // fills in THIS visit instead of waiting for an unrelated event. Bounded so a
  // genuinely-unreadable child head can't thrash the render loop.
  readonly #branchColdRetries = new Map<string, number>()
  static readonly #BRANCH_COLD_MAX_RETRIES = 6
  // Locations whose last paint included unavailable-placeholders (gate
  // exhausted with unresolved children). Their back-nav cell caches are
  // dropped on re-arm (content:arrived / miss-window expiry) so a heal
  // never restores a stale placeholder set from the fast path.
  readonly #placeholderLocations = new Set<string>()
  // Per-location dedupe of `content:missing` emissions — the sorted sig
  // list of the LAST emission. Consecutive identical sets don't re-emit;
  // a complete resolution clears the entry so a later regression does.
  readonly #missingEmitKeyByLocation = new Map<string, string>()
  // Single coalesced miss-window re-arm timer (never a polling loop).
  // Armed from a placeholder paint when the ContentBrokerDrone reports a
  // future missUntil for an unresolved sig; fires ONE re-render shortly
  // after the earliest expiry. A pass that is still incomplete re-arms
  // for the next window, so healing follows the broker's own cadence.
  #missWindowTimer: ReturnType<typeof setTimeout> | null = null
  #missWindowFireAt = 0

  private lineageChangeListening = false

  // incremental rendering state — tracks what's currently painted (geometry cache)
  private readonly renderedCells = new Map<string, Cell>()
  // When true, a takeover feature (e.g. the screensaver bounce mode) owns the
  // screen: the hive layer is hidden and synchronize-driven renders short-
  // circuit so nothing flips it back. Cleared via render:set-hive-visible.
  #hiveHidden = false

  // ── DIVE (wave-view) — another layer's tiles painted IN PLACE of this one ──
  // The wave view resolves a generation and asks for it with `render:dive`;
  // this drone paints it through the SAME shader, atlases and geometry packer
  // the page uses, so a dive IS the tiles underneath rather than a picture of
  // them. The page's mesh is hidden (never torn down), the atlases pin the
  // union of page and dive, and synchronize-driven renders are deferred until
  // the dive ends — which restores the mesh, the pins and the hover exactly.
  #diveActive = false
  #diveHidMain = false
  #diveMesh: any | null = null
  #diveGeom: Geometry | null = null
  #diveCells: Cell[] = []
  #divePortals: ReadonlySet<string> = new Set<string>()
  readonly #diveLabelToIndex = new Map<string, number>()
  #diveHoverLabel: string | null = null
  #diveToken = 0

  /** A lightweight snapshot of the tiles currently painted at this node —
   *  axial coords, label, image signature, and whether text is suppressed.
   *  Used by takeover features (screensaver) that need the visible tile set,
   *  what each tile shows, and where it sits, without reaching into render
   *  internals. */
  /** The location whose tiles the mesh currently shows ('' before the
   *  first paint). view.bee holds a departing arrival face up until this
   *  catches up with the lineage, so the hexagon reveal always shows the
   *  DESTINATION's grid — never the previous page's mesh, never a blank
   *  field mid-stream. */
  public get paintedLocationKey(): string { return this.renderedLocationKey }

  /** The ViewMode service we are listening to, so dispose can let go. */
  #viewModeSource: EventTarget | null = null

  /** BACK ON THE HEXAGONS. Make sure the tiles under the surface are THIS
   *  location's, and painted. Any other mode is a takeover mounting — it
   *  owns the screen, and the arrival gate orders its paint.
   *
   *  The FORCE is the whole point: closing a view usually leaves the
   *  location alone, so without it the pass is dropped as an unchanged
   *  page and the empty field stays empty. While the hive is deliberately
   *  hidden (the screensaver's takeover) this stands aside — that owner
   *  restores its own visibility, and un-hiding here would tear a hole in
   *  its screen. */
  readonly #onViewModeChange = (event: Event): void => {
    const mode = String((event as CustomEvent<{ mode?: string }>).detail?.mode ?? '')
    if (mode !== HEXAGONS_SURFACE || this.#hiveHidden) return
    const currentKey = String(this.resolve<any>('lineage')?.explorerLabel?.() ?? '/')
    if (this.renderedLocationKey && currentKey !== this.renderedLocationKey) {
      this.clearMesh('left a view standing somewhere else — drop the stale tiles before the repaint')
    }
    if (this.layer) this.layer.visible = true
    this.#forceNextRender = true
    this.requestRender()
  }

  public snapshotCells(): { q: number; r: number; label: string; imageSig?: string; hideText?: boolean }[] {
    return [...this.renderedCells.values()].map(c => ({ q: c.q, r: c.r, label: c.label, imageSig: c.imageSig, hideText: c.hideText }))
  }
  // per-layer cache: location key → cells array (for instant back-navigation)
  #layerCellsCache = new Map<string, { cells: Cell[]; cellNames: string[]; localCellSet: Set<string>; branchSet: Set<string> }>()
  // per-layer viewport snapshot cache — skips OPFS read of `0000` on back-nav fast path.
  // Safe to keep across cell-content changes; only the persisted viewport of another
  // layer can write here, and the SPA can't reach that layer without revisiting.
  #layerViewportCache = new Map<string, ViewportSnapshot>()
  // Prepared first visits skip the slow navigation path, so preserve the
  // adopted-content fit decision alongside the prepared empty viewport. The
  // fast path consumes the marker exactly once before its first paint.
  #preparedFirstVisitFit = new Set<string>()
  // per-layer explorerDir cache — skips OPFS directory resolution on back-nav fast path.
  // Entries are keyed by locationKey, so path renames produce a different key and the
  // stale handle simply goes unreferenced.
  #layerDirCache = new Map<string, FileSystemDirectoryHandle>()
  #heatByLabel = new Map<string, number>()
  #flashLabels = new Set<string>()
  #flashTimer: ReturnType<typeof setTimeout> | null = null
  // newly created tiles glow briefly so the user can spot them, then fade
  #newCellFadeStart = new Map<string, number>()
  #newCellFadeRaf = 0
  static readonly #NEW_CELL_FADE_MS = 2500
  #translatingLabels = new Set<string>()
  #translationPulseTimer: ReturnType<typeof setInterval> | null = null
  private streamActive = false
  // Monotonic stream token. Every call to streamCells captures the current
  // value; if the renderer starts a new stream (layer switch) it increments
  // the token, so any batch still awaiting in the old stream sees a
  // mismatch on its next iteration and bails out. Using a number here
  // instead of a boolean "cancel" flag is load-bearing: the old flag was
  // reset to false by the incoming stream's synchronous prelude before
  // the outgoing stream's next iteration ever observed it, so the
  // outgoing stream kept running — wrote its (stale) cells into the
  // shared mesh, and poisoned #layerCellsCache under the new layer's
  // key. The counter cannot be clobbered: once bumped, it never goes
  // back.
  #streamToken = 0
  // Set at the top of renderFromSynchronize, cleared at the end. Catches
  // duplicate calls for the same target while the first one is still
  // running. The fast path doesn't set streamActive, so the streamActive
  // check alone misses these — back-nav was running its body twice per
  // click because of the popstate→navigate→lineage-change cascade.
  #activeRenderTarget: string | null = null
  // Set by invalidation effects (e.g. swarm:resource-arrived) that fire
  // while a render may be in flight. Without it, the in-flight render
  // writes a fresh renderedCellsKey on completion, and the queued
  // re-render hits the fast-path skip below because renderedCellsKey is
  // no longer empty. Honoring this flag in the fast-path check (and
  // clearing it once we proceed) makes the invalidation survive the race.
  #forceNextRender = false
  private renderedLocationKey = ''
  #heartbeatInitialized = false
  #lastHeartbeatKey = ''
  #accentColor: [number, number, number] = [0.4, 0.85, 1.0]

  // hex geometry (circumradius, gap, pad, spacing) — configurable via render:set-gap effect
  #hexGeo: HexGeometry = DEFAULT_HEX_GEOMETRY

  // hex orientation: 'point-top' (default) or 'flat-top'
  #flat = false
  #pivot = false
  #textOnly = false
  #labelsVisible = true
  /** tile-names:dom — the DOM name layer (tile-name.drone.ts) is mounted and
   *  draws the glyphs as real text; the shader keeps only the band (u_glyphs 0). */
  #domNames = false
  /** Launcher silhouette per rendered label — the same value shapeAttr gets —
   *  so the DOM name layer can stand aside where the shader draws its own strip. */
  #shapeModeByLabel = new Map<string, number>()

  /** Does a tile's `hideText` mark actually hide its name right now?
   *  Only ever when the image it hides BEHIND is on screen: an image that
   *  never landed hid nothing, and TEXT-ONLY mode draws no images at all —
   *  there the mark has nothing to hide behind, so every tile shows its
   *  name back, per-tile setting or not. The single answer for every
   *  labelUV write site (bake, in-place update, hover reveal). */
  #hidesName(hideText: boolean | undefined, imagePresent: boolean): boolean {
    return !!hideText && imagePresent && !this.#textOnly
  }
  /** Rows the hovered tile's label band must hold (overlay:band-rows). Held as
   *  drone state, not just pushed at the shader, because a render pass can
   *  REBUILD the shader — and the overlay only re-lays-out when the hovered hex
   *  changes, so it would not re-send. Without this the band silently reverted
   *  to one row under two rows of icons, which read as icons floating outside
   *  their background above and below. Restored with the other uniforms on
   *  every pass; see the setFlat/setPivot block in applyGeometry. */
  #bandRows = 1
  /** The tile #bandRows was computed FOR. A row count is only ever true of one
   *  tile, so it is stored with its owner and pushed at the shader only while
   *  that tile is the hover (#applyBandRows). Navigating in used to carry the
   *  LEAVING tile's count into the arriving level — a band drawn for one icon
   *  row under a tile whose icons wrapped to two, which reads as the rows
   *  collapsing the moment you go inside. */
  #bandRowsLabel: string | null = null
  /** Push the band height at the shader. The ONE place that decides it: the
   *  stored count applies only to the tile it was computed for, and any other
   *  tile — including one that merely shares a name with a tile on the level we
   *  just left — gets the resting single row. Called from every path that can
   *  change either half of that pair (row count, hover, geometry rebuild). */
  #applyBandRows(): void {
    const owned = this.#hoverRevealLabel !== null && this.#bandRowsLabel === this.#hoverRevealLabel
    this.shader?.setBandRows(owned ? this.#bandRows : 1)
  }
  /** Put the hover on `label` (null = nothing hovered): the name reveal, the
   *  band height, the lit cell and its shade lift. ONE path, so the band and
   *  the icons can never end up describing different tiles — whichever message
   *  carried the news. A shaded tile is NOT out of reach: hovering it lifts the
   *  shade and lights its ring like any other, because "this isn't loaded yet"
   *  must never become "you may not go here". */
  #applyHover(label: string | null): void {
    this.#setHoverReveal(label)
    this.#applyBandRows()
    if (!this.shader) return
    this.shader.setHoveredIndex(label !== null ? this.#labelToIndex.get(label) ?? -1 : -1)
    this.#setHoverOpaque(label)
  }
  #substrateFadeStart: number | null = null
  #substrateFadeRaf = 0
  // Launcher motion (the games march) — a per-tile float driven in the vertex
  // shader (u_time + u_driftAmp). Active only on launch-group aggregator pages;
  // a single rAF advances the clock, geometry is never rebuilt.
  #driftRaf = 0
  #driftActive = false
  #driftStart = 0
  // Portal shimmer clock — advances u_time while a reference/portal tile is
  // hovered so its magical hover animates on an otherwise-static hive page. It
  // shares the u_time uniform and #driftStart origin with launcher drift; only
  // one drives the clock at a time (drift wins on launcher pages, where u_time
  // is already ticking, so the shimmer rides it for free).
  #portalShimmerRaf = 0
  #portalShimmerActive = false
  #showHiddenItems = false
  #currentHiddenSet = new Set<string>()
  /** Launcher-page tiles whose behaviour is switched off — painted as hidden
   *  items whatever the show-hidden eye says (see the filter pass). */
  #dormantLaunchLabels = new Set<string>()
  // World mode (control-bar toggle): when on, tiles that are NOT public
  // render dimmed (a "what you're sharing" preview). It never removes tiles —
  // everything stays visible, unshared ones just dim.
  #worldMode = (() => {
    try { return localStorage.getItem('hc:world-mode') === '1' } catch { return false }
  })()
  // Names of cells in the current render that came from an ephemeral
  // tile source (sync preview, not adopted to OPFS). Used by the pinned
  // index writer to skip per-cell OPFS writes that would NotFound, and
  // by the pixi draw path to apply the dashed-accent preview style.
  // Cleared and rebuilt on each renderFromSynchronize.
  #ephemeralCellSet = new Set<string>()

  // A reference composition borrows the ordinary tile renderer without
  // joining the layer yet. It therefore looks and sits exactly like the tile
  // that Save will commit, while remaining disposable on Cancel.
  #referenceDraft: ReferenceDraftPreview | null = null

  // Names of cells in the current render that came from a swarm peer
  // (kind:'peer' from TileSourceRegistry). Treated like ephemeral for
  // visual treatment, but additionally surfaced as branches so a click
  // navigates into them — that's the "browse a peer's tree without
  // adopting first" path. The new lineage's swarm subscription picks
  // up whatever the peer is publishing at the deeper level (if any),
  // and the user can add normally from there to mint local tiles.
  #peerCellSet = new Set<string>()

  // Per-label pubkey of the peer that contributed each peer-kind tile.
  // Populated alongside #peerCellSet; the spotlight render hook reads
  // this to decide which tiles to glow when a peer is active. Cleared
  // and rebuilt on each renderFromSynchronize pass.
  #peerPubkeyByLabel = new Map<string, string>()

  // Participant filter — selected peer pubkeys mirrored from the
  // `swarm:filter` effect (SwarmFilterService owns the truth). Empty =
  // no filter. The AUTHORITATIVE filter runs at the source
  // (swarm.drone #registerTileSource, pre-registry-dedup); the render
  // pass re-applies it as belt-and-braces against a stale
  // #sourceEntriesCache in the frame a toggle lands.
  #participantFilter = new Set<string>()

  /** Where each tile sits: indexed, peer, score-filled, framed (tile-order.ts). */
  readonly #order: TileOrder = new TileOrder({
    axial: () => this.resolve<any>('axial'),
    lineage: () => this.resolve<any>('lineage'),
    slots: () => this.#slots,
    referenceDraft: () => this.#referenceDraft,
    keyword: () => this.filterKeyword,
    tagsFor: label => this.#narrow.tagsFor(label),
    invalidate: () => { this.renderedCellsKey = ''; this.#layerCellsCache.clear(); this.requestRender() },
  })

  // Currently spotlit peer pubkey (from SpotlightService), or null
  // when no layer is surfaced. Subscribed on the first heartbeat so
  // the service is registered by then. Render reads this in
  // buildCellsFromAxial to override borderColor for matching tiles.
  #spotlightPubkey: string | null = null

  // Labels rendering the SPOTLIT participant's version of a tile you
  // also hold. Under superimposition a peer's `notes` is not a second
  // tile beside yours, it is the same tile seen through their layer —
  // so while their layer is surfaced these labels ride the external
  // path (their streamed image, no local prop reads) even though the
  // name is in localCellSet. Empty whenever no peer is spotlit.
  #stackVariantLabels = new Set<string>()

  // Depth of each label's participant stack (1 = only one of you holds
  // it). Read by the GPU write loop to mark tiles that have versions
  // underneath, so multiplicity is visible BEFORE you roll.
  #stackDepthByLabel = new Map<string, number>()


  // Public/swarm mode. When on, EVERY tile is navigable (you can drill
  // into an empty tile to explore / invite others), unlike private mode
  // where only branch tiles — ones that already have children — open on
  // click. Mirrors the master privacy switch (`hc:mesh-public`) and is
  // kept live via the `mesh:public-changed` effect.
  #publicMode = (() => {
    try { return localStorage.getItem('hc:mesh-public') === 'true' } catch { return false }
  })()

  // Per-tile presence glow (0..1), keyed by child name. Reflects how many
  // peers are currently inside (or entering) each child location at the
  // current swarm sig: a tile someone is exploring glows, and the glow
  // gets stronger the more people are there. Folded into the SDF heat
  // ring in buildCellsFromAxial. Rebuilt by #refreshPresenceGlow on every
  // render and whenever swarm interest changes. Empty in private mode.
  #presenceGlowByLabel = new Map<string, number>()

  /** The tiles this page shares on the mesh, and the peers' tiles here (tile-mesh.ts). */
  readonly #mesh: TileMesh = new TileMesh({
    lineage: () => this.resolve<any>('lineage'),
    mesh: () => this.tryGetMesh(),
    signatureOf: lineage => this.computeSignatureLocation(lineage),
    emit: (effect, payload) => this.emitEffect(effect, payload),
    requestRender: () => this.requestRender(),
  })

  #lastCursorPosition = -1
  #lastCursorRewound = false
  #lastCursorLocationSig = ''

  private filterKeyword = ''
  /** What narrows the page — the tag lens, a reference's requirement, a
   *  gathered set — and the cross-page walk behind it (tile-narrowing.ts). */
  readonly #narrow: TileNarrowing = new TileNarrowing({
    segments: () => { const segs = this.resolve<any>('lineage')?.explorerSegments?.(); return segs ? [...segs] : [] },
    cachedTags: label => this.#faces.tags.get(label),
    emit: (effect, payload) => this.emitEffect(effect, payload),
    repaint: () => { this.renderedCellsKey = ''; this.requestRender() },
    requestRender: () => this.requestRender(),
    goRaw: segments => (window as any).ioc?.get?.('@hypercomb.social/Navigation')?.goRaw?.(segments),
    history: () => (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService'),
    store: () => (window as any).ioc?.get?.('@hypercomb.social/Store'),
  })
  private moveNames: string[] | null = null
  #divergenceFutureAdds = new Set<string>()
  #divergenceFutureRemoves = new Set<string>()
  #pendingRemoves = new Set<string>()
  /** Optimistic additions are already on screen while their history commit
   *  drains. They remain visibly shaded/inert until that commit settles.
   *  Failure is followed by a compensating cell event from LayerCommitter,
   *  so the UI never waits to learn whether it was allowed to change. */
  #pendingCellMutations = new Set<string>()
  /** Tiles staged to lose the keyword being removed (TagRemovalDrone). They
   *  render as a future-remove — struck through, as if the pheromone were
   *  already gone — while the participant builds the list. Nothing is written
   *  until the commit, so this is pure intent, cleared on cancel. */
  #tagRemovalStaged = new Set<string>()
  /** Tiles painted so far by the armed pheromone brush (PheromoneTilesDrone).
   *  The mirror of the staged-removal set: those tiles are losing a keyword and
   *  render as future-removes, these just GAINED one and render as future-adds.
   *  Without it painting is blind — the click writes and nothing on the hive
   *  says so. Cleared when the brush is put down. */
  #tagApplyPainted = new Set<string>()
  /** ── Pheromone preview (hover a mark → its tiles light up) ──────────────
   *  The marks under the cursor somewhere in the chrome, and the labels on
   *  THIS page that carry any of them. Wholly transient: the carriers are
   *  painted straight into the divergence buffer as the value 3 and nothing
   *  else ever writes or persists that value — no Cell record holds it, so
   *  clearing the preview is a restore from the records, not a recomputation.
   *  A hover must not cost a render pass, hence the in-place attribute push. */
  #markPreviewMarks: string[] = []
  #markPreviewLabels = new Set<string>()
  #markPreviewColor: [number, number, number] = [0.55, 0.85, 1.0]
  /** THE BOUQUET IN HAND (`tags:apply-pending`) — the STANDING sibling of the
   *  hover preview above, riding the same buffer flag and the same u_markPreview
   *  ramp. Opposite matching rule, deliberately: a hover asks "who carries ANY
   *  of these?" and lights them; the armed bouquet asks "who already wears ALL
   *  of it?" — those stay lit as settled ground, and every tile still missing
   *  part of the set recedes, which is exactly the set a click will scent
   *  (TileOverlayDrone's takeover asks the same question). A live hover
   *  outranks it while it lasts; ending the hover falls back to this. */
  #armedApplyMarks: string[] = []
  #armedApplyColor: [number, number, number] | null = null
  /** A pheromone (or a whole bouquet) is being DRAGGED out of the panel
   *  (`drop:dragging {marks, color}`). Same treatment and same ALL-match rule
   *  as the armed bouquet, for the length of the drag: where the drop would DO
   *  something is shaded before anything is released. Outranks both the hover
   *  preview and the armed set while it lasts. */
  #dragShadeMarks: string[] = []
  #dragShadeColor: [number, number, number] | null = null
  /** 0..1 ramp — the whole treatment fades in and out (see u_markPreview). */
  #markPreviewK = 0
  #markPreviewTarget = 0
  #markPreviewRaf = 0
  /** The geometry the carrier flags were painted into. A rebuild (a repaint, a
   *  navigation, a warm-mesh swap) makes a NEW buffer with the baked values, so
   *  the preview repaints itself when this stops matching — one reference
   *  compare per frame, and no hook into the render path. */
  #markPreviewGeom: unknown = null
  /** When cursor is rewound, holds cell→propertiesSig overrides from content-state ops. */
  #cursorPropsOverride: Map<string, string> | null = null
  /** Cache key for cursor-time reconstruction: `{locationSig}:{position}` — avoids redundant OPFS reads */
  #cursorReconstructionKey = ''
  // One-shot recenter flag. Default false — data operations (move,
  // add, remove, reorder) NEVER autocenter. The page-nav path sets
  // this to true when it wants the next applyGeometry pass to recenter
  // the mesh on its bounds; applyGeometry consumes it (clears it back
  // to false after firing). The empty→populated viewport-zoom branch
  // gates on the same flag.
  #pendingRecenter = false
  // Last mesh offset captured when clearMesh destroyed the previous
  // hexMesh. The fresh mesh created by applyGeometry restores this
  // offset (when no recenter is pending) so the empty→non-empty
  // transition during a cursor-driven undo/redo doesn't snap content
  // back to (0,0) — tiles render at the same world position as before.
  #lastMeshOffset: { x: number; y: number } | null = null
  // Saved mesh offset awaiting hexMesh creation (set by
  // #applyViewportFromSnapshot when called before applyGeometry has
  // built the mesh — first render after refresh, deep-link load,
  // post-clearMesh rebuild). Consumed once when the new mesh is created.
  #pendingMeshOffsetRestore: { x: number; y: number } | null = null
  // When the saved zoom is a fit (snap.zoom.fit), we can't apply its
  // (cx, cy) directly — those were derived from the safe area at save
  // time and would leave content shrunk in the new viewport. Set this
  // flag in #applyViewportFromSnapshot and consume it after
  // applyGeometry, so the refit runs against valid mesh bounds.
  #pendingFitRestore = false
  #layoutMode: 'dense' | 'pinned' = 'dense'

  // First-visit fit (adopted content): the first time the participant opens a
  // location inside a branch they adopted — the adopted root or any page
  // beneath it, with no saved viewport yet — frame it to its own content. The
  // fit runs in applyGeometry BEFORE the layer is revealed, so tiles appear
  // already sized (no render-then-resize "creep"), and it persists with
  // source 'user' so it fires exactly once: subsequent visits restore the
  // saved viewport like any normal sticky location (or the user's later
  // pan/zoom edits).
  #pendingFirstVisitFit = false

  // cached render context for fast move:preview path (avoids full OPFS re-read)
  private cachedCellNames: string[] | null = null
  private cachedLocalCellSet: Set<string> | null = null
  private cachedBranchSet: Set<string> | null = null

  // Arranging is optimistic: the sequence controller moves the live mesh
  // first, then persists each tile's index in the background. Keep those
  // temporary sparse slot maps per location so an in-flight save cannot
  // rearrange a different page after navigation.
  readonly #arrangePreviewNames = new Map<string, string[]>()

  // State machine for slot ordering — the authoritative source of cellNames
  // during incremental updates. Seeded after every full render; mutated via
  // add()/remove() by incremental paths. Encapsulates dense vs pinned logic.
  readonly #slots = new CellSlots()

  // Coalesce rapid cell:added / cell:removed events fired in the same JS turn.
  // The handlers mutate #slots synchronously; a single microtask runs one
  // applyGeometry at the end of the turn. Zero awaits in the click path.
  // Pending incremental adds carry the SEGMENTS captured synchronously at
  // event time — the microtask defer below plus TileOrder.placeNew's write
  // must never re-read live lineage (a navigation in that window pinned
  // the new cell's index against the WRONG location's layer).
  #pendingAdds: { name: string; segments: readonly string[] }[] = []
  #pendingRemovals: string[] = []
  #incrementalScheduled = false

  // Phase 2: buffer references + label→index map for in-place cell attribute updates
  // (used by tile:saved fast path — mutate slices and push to GPU without rebuilding geometry)
  #buf: {
    pos?: Float32Array
    labelUV?: Float32Array
    imageUV?: Float32Array
    hasImage?: Float32Array
    heat?: Float32Array
    identityColor?: Float32Array
    branch?: Float32Array
    borderColor?: Float32Array
    divergence?: Float32Array
    shaded?: Float32Array
  } = {}
  #labelToIndex = new Map<string, number>()

  private readonly onSynchronize = (): void => {
    this.requestRender()
  }

  private readonly onLineageChange = (): void => {
    this.requestRender()
  }

  private readonly onNavigate = (): void => {
    this.requestRender()
  }

  private readonly adoptHostPayload = (payload: HostReadyPayload): void => {
    this.pixiApp = payload.app
    this.pixiContainer = payload.container
    this.pixiRenderer = payload.renderer
    this.requestRender()
  }

  /**
   * WARM THE PROPS. LET THE IMAGES ARRIVE AT IDLE.
   *
   * The props blobs stay warm and awaited: they are the map from a tile to its
   * `small.image`, they are under a kilobyte each, and the render path is
   * measurably NOT tolerant of finding them cold — gutting this warm entirely
   * left tiles painting with no picture at all, which is the very complaint
   * this work started from.
   *
   * The IMAGES are a different animal. Preheating every `small.image` in the
   * hive read 41.7 MB before first paint (native boot IO census, real hive) to
   * draw NINE tiles, and the renderer's own reads queued behind the flood. The
   * bytes a visible tile needs are read by the render path itself; this warm
   * only ever helped tiles the user had not navigated to. So it yields —
   * `requestIdleCallback`, four at a time — and the first paint stops paying
   * for pictures nobody is looking at yet.
   */
  public override async warmup(): Promise<void> {
    try {
      const propsIndex = readTilePropsIndex() as Record<string, unknown>
      if (Object.keys(propsIndex).length === 0) return
      // Full-lineage (sig) keys aren't labels — only legacy bare-label
      // entries can seed the atlas's label slots.
      this.#warmLabels = Object.keys(propsIndex).filter(k => !/^[0-9a-f]{64}$/.test(k))

      const propsSigs = Object.values(propsIndex)
        .filter((v): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v))
      if (!propsSigs.length) return

      const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as
        { preheatResource?: (sig: string) => Promise<Blob | null> } | undefined
      if (!store?.preheatResource) return

      const propsBlobs = await Promise.all(
        propsSigs.map(sig => store.preheatResource!(sig).catch(() => null))
      )

      const imageSigs = new Set<string>()
      for (const blob of propsBlobs) {
        if (!blob) continue
        try {
          const props = JSON.parse(await blob.text())
          const sig = recoverableTileImageSig(props)
          if (typeof sig === 'string' && /^[a-f0-9]{64}$/i.test(sig)) imageSigs.add(sig)
        } catch { /* skip malformed */ }
      }

      if (imageSigs.size) this.#preheatImagesAtIdle([...imageSigs], store.preheatResource)
    } catch { /* best-effort */ }
  }

  /** Feed the image warm through idle time, a few at a time, so it can never
   *  again be a first-paint tax. Best-effort throughout: a tile that needs one
   *  of these reads it itself. */
  #preheatImagesAtIdle = (sigs: string[], preheat: (sig: string) => Promise<Blob | null>): void => {
    const queue = [...sigs]
    const whenIdle = (run: () => void): void => {
      const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
      if (typeof ric === 'function') ric(run)
      else setTimeout(run, 1500)
    }
    const pump = (): void => {
      const batch = queue.splice(0, 4)
      if (!batch.length) return
      void Promise.allSettled(batch.map(sig => preheat(sig).catch(() => null)))
        .then(() => { if (queue.length) whenIdle(pump) })
    }
    whenIdle(pump)
  }

  #warmLabels: string[] = []

  protected override heartbeat = async (grammar: string = ''): Promise<void> => {
    this.ensureListeners()

    // emit initial geometry so consumers start in sync (first pulse only)
    if (!this.#heartbeatInitialized) {
      this.#heartbeatInitialized = true
      this.emitEffect('render:geometry-changed', this.#hexGeo)
    }

    // mesh cell refresh — only when lineage/grammar actually changed
    const lineage = this.resolve<any>('lineage')
    const locationKey = String(lineage?.explorerLabel?.() ?? '/')
    const fsRev = Number(lineage?.changed?.() ?? 0)
    const heartbeatKey = `${locationKey}:${fsRev}:${grammar}`
    if (heartbeatKey !== this.#lastHeartbeatKey) {
      this.#lastHeartbeatKey = heartbeatKey
      await this.#mesh.refresh(grammar)
      this.requestRender()
    }
  }

  // Use null sentinel (not '') so the very first call for the root
  // lineage (key === '') doesn't false-hit the cache and return
  // the placeholder { sig: '' }. That bug surfaced as a render loop:
  // cursor.load('') reset cursor state to empty → emit → re-render →
  // cursor.load('') again, indefinitely.
  /**
   * Returns the canonical sigbag for the current lineage location, plus
   * the key that produced it. Goes through lineage.currentSig() — the
   * single navigation+sig primitive — so every caller in this codebase
   * resolves the same sig for the same location via the same cache.
   * The `{ key, sig }` shape is preserved so call sites don't need to
   * change; `key` is `explorerSegments.join('/')` post-normalization,
   * useful for display / logging only.
   */
  private computeSignatureLocation = async (lineage: any): Promise<{ key: string; sig: string }> => {
    const currentSig: () => Promise<string> | undefined = lineage?.currentSig
    const sig = typeof currentSig === 'function' ? await lineage.currentSig() : ''
    const explorerSegmentsRaw = lineage?.explorerSegments?.() ?? []
    // Canonical key via the shared helper so `key` and `sig` describe the same
    // bag (sig comes from lineage.currentSig() → HistoryService.sign, which
    // hashes this exact canonical key).
    const key = lineageKey(explorerSegmentsRaw)
    return { key, sig }
  }

  // mesh discovery — resolves whichever mesh drone is registered
  // note: data queries (getNonExpired, subscribe) still use the direct API
  // coordination (ensureStartedForSig, publish) also emits effects for observability
  private tryGetMesh = (): MeshApi | null => {
    return get<MeshApi>('@diamondcoreprocessor.com/NostrMeshDrone') ?? null
  }


  #renderScheduled = false

  // ── QUIET LANDING ─────────────────────────────────────────────────
  // A background writer — the bridge answering an ask raised from a tile
  // — lands its payload as TRUTH the moment it arrives: the layer is
  // minted, the note is on the cell, the resource is in the pool. What it
  // must NOT do is pull the surface out from under the participant. A
  // drained ask writes a dozen notes in one burst, and a dozen full
  // re-walks is a dozen flickers on a hive somebody is still working in.
  //
  // So the WRITE lands and the PAINT waits. `landing:quiet` brackets the
  // writer's burst (the producer owns the depth count and the settle
  // delay, so a burst is ONE window); every render request inside the
  // window is counted instead of run, and the count goes out on
  // `landing:pending` for the badge to show. The participant taps it when
  // they are ready — `landing:apply` — and that tap is the only release.
  //
  // Held is not dropped, and never lost: holding ARMS #forceNextRender, so
  // whenever the pass finally runs it survives the unchanged-page fast
  // path. And a render that happens for any other reason (they panned,
  // they walked into a layer, they edited something) has already shown
  // them what landed, so it clears the count on the way through — the
  // badge means "there is something you have not seen yet", never "there
  // is something unwritten".
  #quietLanding = false
  #heldRenders = 0

  /** Location the hold happened at. A pass at a DIFFERENT location is the
   *  participant walking somewhere — that must always paint, and seeing the
   *  new page spends the badge. */
  #heldAtKey: string | null = null

  /** When the last pass was held.
   *
   *  A WRITE'S CONSEQUENCES ARRIVE AS A CHAIN, NOT AN EVENT. The producer's
   *  window covers the write itself; what follows is the commit flushing its
   *  marker, then the readiness repaint as each new tile's visual resolves,
   *  then the optimize tick — measured at 8ms, 36ms, 204ms, 353ms, 407ms,
   *  659ms, 929ms after one three-tile burst, from SEVEN different call sites.
   *  No settle delay on the producer covers that, and tagging the callers is a
   *  losing game: the chain reaches requestRender through paths that look
   *  exactly like a participant's.
   *
   *  So the renderer measures the chain instead of guessing at it. While paints
   *  keep being held, the landing is still landing. Once nothing has been held
   *  for #CASCADE_QUIET_MS, the chain is done and the next paint belongs to the
   *  participant — it runs, and it spends the badge. */
  #lastHeldAt = 0
  static readonly #CASCADE_QUIET_MS = 1500

  #locationKeyNow = (): string =>
    String(this.resolve<any>('lineage')?.explorerLabel?.() ?? '/')

  /** WRITES landed during the window, as counted by the producer — the only
   *  honest number to show a person. Held renders are not writes: a burst of
   *  twelve notes coalesces into far fewer paints, so counting paints would
   *  under-report, and a producer that writes nothing but touches the layer
   *  would over-report. Survives the window closing (the badge outlives the
   *  burst); cleared only when a real paint shows them. */
  #landedWrites = 0

  /** Publish the unseen-change count for the landing badge. */
  #publishHeld = (): void => {
    this.emitEffect('landing:pending', {
      count: this.#heldRenders > 0 ? (this.#landedWrites || this.#heldRenders) : 0,
      where: String(this.resolve<any>('lineage')?.explorerLabel?.() ?? '/'),
    })
  }

  private readonly requestRender = (): void => {
    // Held while the producer's window is open — whatever caused this pass, a
    // bridge `add` reaches here through `cell:added`, not only synchronize —
    // and afterwards for as long as that write is still cascading at a
    // location the participant has not left.
    const now = Date.now()
    const cascading = this.#heldRenders > 0
      && this.#heldAtKey === this.#locationKeyNow()
      && (now - this.#lastHeldAt) < ShowCellDrone.#CASCADE_QUIET_MS
    if (this.#quietLanding || cascading) {
      if (this.#heldRenders === 0) this.#heldAtKey = this.#locationKeyNow()
      this.#heldRenders++
      this.#lastHeldAt = now
      this.#publishHeld()
      return
    }

    // Not held: this pass is about to show them whatever landed — either they
    // acted, or they walked somewhere else. Either way the badge is spent, and
    // the pass that spends it must actually RUN: the held change is at the same
    // location, so the unchanged-page fast path would otherwise return having
    // done nothing and the badge would clear over a surface that never moved.
    if (this.#heldRenders > 0) {
      this.#heldRenders = 0
      this.#landedWrites = 0
      this.#heldAtKey = null
      this.#forceNextRender = true
      this.#publishHeld()
    }

    if (this.rendering) {
      this.renderQueued = true
      return
    }

    // coalesce synchronous bursts into one render via microtask
    if (this.#renderScheduled) return
    this.#renderScheduled = true
    queueMicrotask(() => {
      this.#renderScheduled = false
      if (this.rendering) {
        this.renderQueued = true
        return
      }
      this.rendering = true
      void (async () => {
        try {
          do {
            this.renderQueued = false
            await this.renderFromSynchronize()
          } while (this.renderQueued)
        } finally {
          this.rendering = false
        }
      })()
    })
  }

  // Bound on CONSECUTIVE eviction-forced repaints while on-screen sigs
  // keep going missing. A normal layer converges in one or two passes
  // (reload lands, next eviction scan comes back clean and resets the
  // counter). Only a layer with more images than the atlas has slots can
  // keep the scan dirty forever — self-eviction — and that pathology must
  // not be allowed to spin the render loop.
  #evictRepaintCount = 0
  static readonly #EVICT_REPAINT_MAX = 8


  /** An atlas slot was reused for different content. If the displaced sig
   *  belongs to an on-screen cell, its baked UV now points at foreign
   *  pixels — force a pass so the cell either reloads (loadOne re-queues
   *  evicted sigs) or falls back to label. This must run even while a
   *  pass is mid-flight: the eviction may have displaced pixels the
   *  running pass already awaited (loads and evictions from elsewhere
   *  interleave), so its rebuilt geometry is stale the moment it bakes.
   *  requestRender during a pass queues a follow-up pass — bounded by
   *  #EVICT_REPAINT_MAX so self-evicting oversized layers can't loop. */
  readonly #onAtlasEvicted = (e?: Event): void => {
    const atlas = this.imageAtlas
    if (!atlas) return
    // PROMISE REPAIR. A branch that brightened made a promise — "the inside is
    // decoded, the click is instant" — and an eviction can quietly break it:
    // brightness is monotonic per visit, so the tile stays lit while its
    // pixels are gone, and the click pays the decode all over again (the
    // "latency on tiles that have lighted up" bug, reproduced live: 0/12
    // images resident under a still-lit tile). When the victim sig belongs to
    // a PROVEN click target of the current location, withdraw the visual
    // promise and re-queue it for an idle re-bake. Bytes remain local, but the
    // click is no longer instant until the pixels are resident again.
    this.#readiness.imageEvicted((e as CustomEvent<{ sig?: string }> | undefined)?.detail?.sig)
    for (const c of this.renderedCells.values()) {
      if (c.imageSig && !atlas.hasImage(c.imageSig) && !atlas.hasFailed(c.imageSig)) {
        if (this.#evictRepaintCount >= ShowCellDrone.#EVICT_REPAINT_MAX) {
          console.warn('[show-cell] atlas eviction repaint bound reached — layer likely exceeds atlas capacity')
          return
        }
        this.#evictRepaintCount++
        this.#forceNextRender = true
        this.requestRender()
        return
      }
    }
    // Clean scan — every on-screen sig is resolvable again; reset the bound.
    this.#evictRepaintCount = 0
  }

  /** Label-atlas twin of #onAtlasEvicted. A displaced on-screen label's
   *  baked UV samples a DIFFERENT label's glyphs (wrong text — the
   *  superimposed-labels bug class), so force a repaint; the rebuild
   *  re-bakes it on demand. Shares #evictRepaintCount with the image
   *  handler — a converged paint resets both. Cells rendering
   *  hideText-with-image are skipped: their labelUV is intentionally
   *  zeroed, so a displaced label cannot show. */
  readonly #onLabelAtlasEvicted = (e?: Event): void => {
    const atlas = this.atlas
    if (!atlas) return
    // Same promise repair as the image twin: a proven branch's child NAME
    // displaced from the label atlas would make the next click rasterise it
    // again (~13ms each — the single biggest click cost measured). Re-seed it
    // during idle instead.
    this.#readiness.labelEvicted((e as CustomEvent<{ label?: string }> | undefined)?.detail?.label)
    for (const c of this.renderedCells.values()) {
      if (this.#hidesName(c.hideText, !!(c.imageSig && this.imageAtlas?.hasImage(c.imageSig)))) continue
      if (!atlas.hasLabel(c.label)) {
        if (this.#evictRepaintCount >= ShowCellDrone.#EVICT_REPAINT_MAX) {
          console.warn('[show-cell] label-atlas eviction repaint bound reached — more on-screen labels than atlas slots')
          return
        }
        this.#evictRepaintCount++
        this.#forceNextRender = true
        this.requestRender()
        return
      }
    }
  }

  /** Fast path for move:preview — skips OPFS/mesh/image loading, only rebuilds geometry with reordered labels */
  private readonly renderMovePreview = (): void => {
    const axial = this.resolve<any>('axial')
    if (!axial?.items || !this.cachedCellNames || !this.cachedLocalCellSet) {
      this.requestRender()
      return
    }

    const cellNames = this.cachedCellNames
    const localCellSet = this.cachedLocalCellSet
    const branchSet = this.cachedBranchSet ?? new Set<string>()

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const previewNames = this.#effectivePreviewNames() ?? this.#railRanks(cellNames)
    const effectiveLen = previewNames ? previewNames.length : cellNames.length
    const maxCells = Math.min(effectiveLen, axialMax)
    if (maxCells <= 0) return

    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    if (cells.length === 0) return

    // reuse cached image sigs (no OPFS read needed)
    const atlas = this.imageAtlas
    const needReload: Cell[] = []
    for (const cell of cells) {
      // EXTERNAL (peer) cells: the cache is coherent by construction now —
      // loadOne validates it against the publisher's CURRENT sig
      // (peerImageSourceByLabel) and externals never receive local
      // substrate picks. Bind it so peer images survive synchronize-
      // driven fast rebuilds (skipping entirely left them imageless);
      // queue a load when no derivation exists yet or the atlas evicted.
      if (cell.external) {
        const cachedSig = this.#faces.images.get(cell.label) ?? undefined
        if (cachedSig) {
          cell.imageSig = cachedSig
          if (atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) needReload.push(cell)
        } else {
          needReload.push(cell)
        }
        continue
      }
      if (this.#faces.images.has(cell.label)) {
        const cachedSig = this.#faces.images.get(cell.label) ?? undefined
        cell.imageSig = cachedSig
        // If the atlas evicted this sig (wrap) we must re-queue a load
        // or the shader falls back to label. Collect here, load after
        // the loop so loadCellImages handles batching + dedup.
        if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) {
          needReload.push(cell)
        }
      }
    }

    const finishPreview = (): void => {
      this.renderedCells.clear()
      for (const cell of cells) this.renderedCells.set(cell.label, cell)
      void this.applyGeometry(cells)
    }

    if (needReload.length > 0) {
      // Image-complete paint: a tile must NEVER render without its image
      // outside text-only mode. Finish the (local) reloads BEFORE painting
      // — the previous geometry stays visible meanwhile, which is images
      // at old positions rather than an imageless flash.
      void (async () => {
        const lineage = this.resolve<any>('lineage')
        // dir may be null at foreign locations — loadCellImages is
        // null-tolerant and external tiles don't need a local dir.
        const dir = (await lineage?.explorerDir?.()) ?? null
        await this.loadCellImages(needReload, dir)
        finishPreview()
      })()
      return
    }

    finishPreview()
  }

  #currentLocationKey = (): string => {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    return (lineage?.explorerSegments?.() ?? [])
      .map((segment) => String(segment ?? '').trim())
      .filter(Boolean)
      .join('/')
  }

  #effectivePreviewNames = (): string[] | null =>
    this.moveNames ?? this.#arrangePreviewNames.get(this.#currentLocationKey()) ?? null

  /** THE PHONE'S RAILS READ DENSE RANKS. The slot array is sparse by `index`
   *  — removals leave holes, the desktop allocator parks a new tile at the
   *  free slot nearest the camera (index 30 while 0–9 are used), and a
   *  flower is gappy by design. Read into a strip those holes are empty
   *  rails between tiles, and a feed with twenty empty slots is not a feed.
   *  So while the rail projection is up (the grid is a rail matrix and the
   *  lane lock is on) the renderer walks the OCCUPIED slots in index order:
   *  rank r renders at rail slot r. Render-time only — the layer keeps its
   *  sparse indices; the one gesture that writes order on a phone, a drag,
   *  commits in this same rank space (MoveDrone). A move or arrangement
   *  preview, when one is up, is already in rail-slot space and wins, so
   *  this is consulted only when neither is. Takes the pass's OWN names —
   *  never a cache, which can still describe the layer just left. Null when
   *  the array is already dense, so the ordinary walk runs unchanged. */
  #railRanks = (names: readonly string[]): string[] | null => {
    if (!getLaneScrollAxis()) return null
    const dense = names.filter(Boolean)
    return dense.length === names.length ? null : dense
  }

  /**
   * Incremental render — same-layer tile changes without the full synchronize path.
   * Follows renderMovePreview's pattern: reuse cached context, update only the
   * affected tiles, rebuild geometry without hiding the layer.
   *
   * No OPFS directory scan, no history replay, no fit-to-content, no layer hide.
   */
  /**
   * Queue a cell diff from a synchronous event handler. All mutations happen
   * in one microtask per JS turn — rapid clicks in the same turn coalesce.
   * Zero awaits; the click path is never blocked on OPFS.
   */
  readonly #queueIncremental = (change: { added?: { name: string; segments: readonly string[] }[]; removed?: string[] }): void => {
    if (change.added) for (const n of change.added) this.#pendingAdds.push(n)
    if (change.removed) for (const n of change.removed) this.#pendingRemovals.push(n)
    if (this.#incrementalScheduled) return
    this.#incrementalScheduled = true
    queueMicrotask(() => {
      this.#incrementalScheduled = false
      const added = this.#pendingAdds
      const removed = this.#pendingRemovals
      this.#pendingAdds = []
      this.#pendingRemovals = []
      this.#runIncrementalSync({ added, removed })
    })
  }

  /**
   * Synchronous incremental render — uses only the slot state machine and
   * cached image/tag data; no OPFS access. Images for newly-added cells
   * are fetched fire-and-forget and pushed via in-place buffer update when
   * ready.
   */
  readonly #runIncrementalSync = (change: { added: { name: string; segments: readonly string[] }[]; removed: string[] }): void => {
    const axial = this.resolve<any>('axial')
    // A FRAMED page has no incremental placement. The frame decides where
    // every tile sits from the ORDER of the whole set, so adding one tile can
    // move any of the others — the slot machine's "put the new one in a free
    // slot" is the wrong answer by construction. Take the full path, which
    // re-reads the layer through the frame.
    if (!axial?.items || !this.#slots.seeded || this.#order.isFramed()) {
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
      return
    }

    for (const name of change.removed) {
      this.#slots.remove(name)
      this.renderedCells.delete(name)
    }

    for (const { name, segments } of change.added) {
      // hasBranch defaults to false for newly-added cells (no children yet).
      // The async fill pass below will correct this if needed.
      if (this.#slots.add(name, false)) continue
      // Pinned mode (the only mode): #slots.add defers slot assignment.
      // Place the new cell HERE exactly as TileOrder.pinned would for an
      // unindexed cell — viewport-scored free slot, persisted fire-and-forget
      // — and render incrementally. The old behaviour fell back to a full
      // OPFS re-scan of the whole grid on every create, which both lagged the
      // click and re-rendered every existing tile. Only a genuinely full grid
      // (or missing axial) forces the slow path now.
      if (this.#order.placeNew(name, segments) < 0) {
        this.#layerCellsCache.delete(this.renderedLocationKey)
        this.renderedCellsKey = ''
        this.requestRender()
        return
      }
    }

    const snap = this.#slots.snapshot()
    const cellNames = snap.names
    const localCellSet = snap.localCells
    const branchSet = snap.branches

    this.cachedCellNames = cellNames
    this.cachedLocalCellSet = localCellSet
    this.cachedBranchSet = branchSet

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const maxCells = Math.min(cellNames.length, axialMax)
    if (maxCells <= 0) { this.clearMesh(`incremental: maxCells=0 (names=${cellNames.length}, axial=${axialMax})`, true); return }

    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    if (cells.length === 0) { this.clearMesh("incremental: axial yielded 0 cells", true); return }

    // Populate cells from caches — newly-added cells have no cache entry and
    // will render blank until the async fill completes.
    const atlas = this.imageAtlas
    const needReload: Cell[] = []
    for (const cell of cells) {
      // EXTERNAL cells: bind the coherent cache value (publisher-sig
      // validated in loadOne) and queue missing/evicted ones — but skip
      // the LOCAL decoration caches below (borderColor/link/substrate
      // are this participant's own per-label state, not the peer's).
      if (cell.external) {
        const cachedSig = this.#faces.images.get(cell.label) ?? undefined
        if (cachedSig) {
          cell.imageSig = cachedSig
          if (atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) needReload.push(cell)
        } else {
          needReload.push(cell)
        }
        continue
      }
      if (this.#faces.images.has(cell.label)) {
        const cachedSig = this.#faces.images.get(cell.label) ?? undefined
        cell.imageSig = cachedSig
        // atlas eviction check — if the cached sig is no longer in the
        // atlas (wrap displaced it) queue a reload. Same shape as the
        // renderIncremental path above.
        if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) {
          needReload.push(cell)
        }
      }
      const bc = this.#faces.borders.get(cell.label)
      if (bc) cell.borderColor = bc
      cell.hasLink = this.#faces.links.get(cell.label) ?? false
      cell.hasSubstrate = this.#faces.substrates.get(cell.label) ?? false
      cell.hideText = this.#faces.hiddenText.get(cell.label) ?? false
    }
    const finishIncremental = (fillAdded = true): void => {
      this.renderedCells.clear()
      for (const cell of cells) this.renderedCells.set(cell.label, cell)

      this.#layerCellsCache.set(this.renderedLocationKey, {
        cells: [...cells], cellNames, localCellSet, branchSet,
      })

      // applyGeometry returns a promise but its body is synchronous for our
      // purposes; don't await — the paint happens in the next frame anyway.
      void this.applyGeometry(cells)

      // Fire-and-forget: load images and branch flags for added cells, then
      // push in-place buffer updates. Never blocks the click path. (A
      // just-created tile has no image YET — substrate assigns one right
      // after — which is different from rendering an image-bearing tile
      // without its image; the hard rule targets the latter.)
      if (fillAdded && change.added.length > 0) {
        const added = change.added.map(a => a.name)
        const lineage = this.resolve<any>('lineage')
        void Promise.resolve(lineage?.explorerDir?.()).then(async (dir) => {
          if (!dir) return
          // Branch flags (cheap, parallel). A flip must PROPAGATE: the
          // payload/cache/paint above were built from the pre-fill snapshot,
          // so a silently-marked branch stays invisible to tile-overlay
          // (#branchLabels) and stale in #layerCellsCache. Queue an empty
          // incremental flush to rebuild + re-emit from the marked state.
          // added is empty on that re-run, so the fill doesn't recurse.
          let branchFlipped = false
          await Promise.all(added.map(async name => {
            const hasBranch = await this.checkCellHasBranch(dir, name)
            if (hasBranch && !this.#slots.hasBranch(name)) {
              this.#slots.markBranch(name)  // idempotent; pinned-safe
              branchFlipped = true
            }
          }))
          // Images + props — pushed per-cell via in-place update
          for (const name of added) {
            await this.#tryInPlaceCellUpdate(name, { dir })
          }
          if (branchFlipped) this.#queueIncremental({})
        }).catch(() => { /* best effort */ })
      }

      this.emitEffect('render:cell-count', this.#buildCellCountPayload(cells))
      this.#narrow.emitRenderTags(cells)
    }

    // Membership is interaction truth and must paint on the very next frame.
    // An unrelated atlas eviction must never hold an add/remove hostage while
    // its image decodes. Paint the changed membership now (missing visuals are
    // honestly shaded as pending), then repair those visuals in place.
    finishIncremental()
    if (needReload.length > 0) {
      void (async () => {
        const lineage = this.resolve<any>('lineage')
        const dir = (await lineage?.explorerDir?.()) ?? null
        await this.loadCellImages(needReload, dir)
        // Rebuild only the GPU bindings. Do not start the added-cell fill a
        // second time; the immediate pass above already owns that work.
        finishIncremental(false)
      })().catch(() => { /* the pending shade is the visible failure state */ })
    }
  }

  /**
   * Async incremental render — kept for callers that legitimately need to
   * update cached content (tile:saved fallback, tags:changed, substrate
   * fallback). Never invoked for cell:added/removed.
   */
  private readonly renderIncremental = async (change: {
    added?: string[]
    removed?: string[]
    changedContent?: string[]
    changedTags?: string[]
  }): Promise<void> => {
    const axial = this.resolve<any>('axial')
    const lineage = this.resolve<any>('lineage')
    // Framed pages re-place from the whole set — see #runIncrementalSync.
    if (!axial?.items || !lineage || !this.#slots.seeded || this.#order.isFramed()) {
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
      return
    }

    const dir = await lineage.explorerDir?.()
    if (!dir) { this.requestRender(); return }

    if (change.removed?.length) {
      for (const name of change.removed) { this.#slots.remove(name); this.renderedCells.delete(name) }
    }
    if (change.added?.length) {
      for (const name of change.added) {
        const hasBranch = await this.checkCellHasBranch(dir, name)
        if (!this.#slots.add(name, hasBranch)) {
          this.#layerCellsCache.delete(this.renderedLocationKey)
          this.renderedCellsKey = ''
          this.requestRender()
          return
        }
      }
    }

    const snap = this.#slots.snapshot()
    const cellNames = snap.names
    const localCellSet = snap.localCells
    const branchSet = snap.branches

    this.cachedCellNames = cellNames
    this.cachedLocalCellSet = localCellSet
    this.cachedBranchSet = branchSet

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const maxCells = Math.min(cellNames.length, axialMax)
    if (maxCells <= 0) { this.clearMesh(`changed-pass: maxCells=0 (names=${cellNames.length}, axial=${axialMax})`); return }

    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    if (cells.length === 0) { this.clearMesh("changed-pass: axial yielded 0 cells"); return }

    const touched = new Set<string>([...(change.added ?? []), ...(change.changedContent ?? [])])
    // Include cells whose cached sig is no longer in the atlas — the
    // atlas may have evicted it since the last render (wrap around the
    // slot allocator). Without this, the cell keeps its stale cached
    // sig but the atlas can't resolve its UV, and the shader falls
    // back to the label forever. loadOne's fast-path reload handles
    // the actual re-fetch; here we just make sure loadOne is called.
    const atlas = this.imageAtlas
    const needLoad = cells.filter(c => {
      if (touched.has(c.label)) return true
      if (!this.#faces.images.has(c.label)) return true
      const cachedSig = this.#faces.images.get(c.label)
      if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) return true
      return false
    })
    if (needLoad.length > 0) await this.loadCellImages(needLoad, dir)

    for (const cell of cells) {
      // EXTERNAL cells: needLoad above already queued the no-cache and
      // evicted cases (loadOne binds those directly); here just bind the
      // coherent cache value when loadOne didn't touch this cell. Local
      // decoration caches stay local-only.
      if (cell.external) {
        if (!cell.imageSig) {
          const cachedSig = this.#faces.images.get(cell.label) ?? undefined
          if (cachedSig) cell.imageSig = cachedSig
        }
        continue
      }
      if (this.#faces.images.has(cell.label)) cell.imageSig = this.#faces.images.get(cell.label) ?? undefined
      const bc = this.#faces.borders.get(cell.label)
      if (bc) cell.borderColor = bc
      cell.hasLink = this.#faces.links.get(cell.label) ?? false
      cell.hasSubstrate = this.#faces.substrates.get(cell.label) ?? false
      cell.hideText = this.#faces.hiddenText.get(cell.label) ?? false
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    this.#layerCellsCache.set(this.renderedLocationKey, {
      cells: [...cells], cellNames, localCellSet, branchSet,
    })

    await this.applyGeometry(cells)

    this.emitEffect('render:cell-count', this.#buildCellCountPayload(cells))
    this.#narrow.emitRenderTags(cells)
  }

  private readonly renderFromSynchronize = async (): Promise<void> => {
    ;(window as unknown as { __hcNav?: (l: string, e?: string) => void }).__hcNav?.('render:start')
    // A takeover feature (screensaver) owns the screen — keep the hive hidden
    // and do no work. A queued requestRender fires on restore (set-hive-visible).
    if (this.#hiveHidden) { if (this.layer) this.layer.visible = false; return }
    // A DIVE owns the surface (wave-view): the page's mesh stays hidden and its
    // state untouched until the dive ends, which re-requests this pass.
    // Painting now would re-show the mesh under the dive and re-pin the
    // atlases against the page alone.
    if (this.#diveActive) return
    if (!this.pixiApp || !this.pixiContainer || !this.pixiRenderer) {
      this.clearMesh("synchronize: pixi not ready")
      return
    }

    const axial = this.resolve<any>('axial')
    if (!axial?.items) {
      this.clearMesh("synchronize: axial service unavailable")
      return
    }

    const lineage = this.resolve<any>('lineage')
    if (!lineage?.explorerDir || !lineage?.explorerLabel || !lineage?.changed) {
      this.clearMesh("synchronize: lineage service unavailable")
      return
    }

    const locationKey = String(lineage.explorerLabel?.() ?? '/')
    // THE PASS ADDRESS — captured synchronously alongside locationKey,
    // before the first await. Every downstream consumer that pairs cell
    // NAMES from this pass with a location (index reads, deferred index
    // persistence) must use THIS array, never a live re-read of lineage:
    // the pass spans many awaits and a mid-pass navigation used to make
    // names-from-A meet segments-from-B — the cross-layer graft vector.
    const passSegments: readonly string[] = (lineage.explorerSegments?.() ?? [])
      .map((s: unknown) => String(s ?? '').trim()).filter(Boolean)

    // fast path: skip all OPFS work when nothing has changed
    // renderedCellsKey is cleared by any invalidation event (tile:saved, orientation, clipboard, etc.)
    // #forceNextRender overrides the skip when an effect needs the next render to actually run
    // (e.g. swarm:resource-arrived firing mid-render — see the field declaration for the race details).
    if (
      !this.#forceNextRender
      && locationKey === this.renderedLocationKey
      && this.renderedCellsKey !== ''
    ) {
      return
    }

    // ── coalesce duplicate renders for the same target ───────────────
    // One user nav gesture fires 3–5 events: popstate, navigate,
    // sometimes synchronize, plus lineage 'change' (from invalidate).
    // Each schedules a requestRender. Two cases of duplicates we must
    // catch before any work runs:
    //
    //   (A) #activeRenderTarget — set at the top of THIS function,
    //       cleared in finally. Catches duplicates while ANY part of
    //       renderFromSynchronize body is still running for this target,
    //       including the back-nav fast path (which doesn't set
    //       streamActive). Without this, the IIFE's do-while was running
    //       the back-nav fast path twice per click.
    //
    //   (B) streamActive — set when streamCells starts, cleared when it
    //       ends. Catches duplicates that arrive AFTER the slow path's
    //       outer renderFromSynchronize returns but while streamCells is
    //       still running async.
    if (
      this.#activeRenderTarget === locationKey ||
      (this.streamActive && locationKey === this.renderedLocationKey)
    ) {
      // A FORCED invalidation (launcher:reconciled, swarm arrivals) must not
      // be swallowed by this drop: the in-flight pass gathered its cells
      // BEFORE the invalidation, so letting it stand paints stale content
      // with nothing queued behind it. Keep #forceNextRender armed (it is
      // only consumed below, when a pass actually runs) and retry once the
      // active pass / stream has settled.
      // ...unless a landing is being held. This retry is an internal
      // continuation, not a participant asking for a paint, so it must not be
      // the thing that spends the badge — it used to re-arm itself every 50ms
      // and paint the moment the quiet window closed, which is the exact
      // flicker quiet landing exists to prevent. The tap runs the pass.
      if (this.#forceNextRender && this.#heldRenders === 0) {
        setTimeout(() => this.requestRender(), 50)
      }
      return
    }
    this.#forceNextRender = false

    // Rendering owns the main thread until this pass publishes its matching
    // cell snapshot. The pass id is how a listener rejects a replayed
    // cell-count from the layer the participant just left — SequenceCycleDrone
    // today. (The agent bees held that gate until e5be06adc; they wait behind
    // the boot paint barrier now, not this id.)
    const renderPassId = ++this.#tileRenderPassId
    this.emitEffect('render:tiles-target', { locationKey, renderPassId })

    // Only a pass that actually proceeds may invalidate shader hover. One
    // navigation queues several duplicate renders; a late duplicate commonly
    // reaches the unchanged-page return above. Clearing hover before that
    // return left the stationary pointer's tile with a one-row band until the
    // cursor exited and re-entered. A real pass emits render:cell-count when it
    // completes, so TileOverlayDrone recovers hover against the fresh map.
    this.shader?.setHoveredIndex(-1)

    // From here on we own the render for this target. Wrap the rest in
    // try/finally so the flag is reliably cleared even on early return
    // or throw. (The return statements throughout the body below will
    // run finally; the implicit `return` at function end too.)
    this.#activeRenderTarget = locationKey
    try {
      // THE ARRIVAL GATE — when this layer opens as a view, the view must be
      // the FIRST thing on screen, so the gate holds this paint until
      // view.bee's verdict has landed (and the surface has flipped). Then it
      // paints anyway, under the covered canvas: the paint is not waste —
      // the resolved cells are the tile roster every deck-shaped view (and
      // the decoration hydration walk) feeds on, and the mesh is what the
      // escape back to hexagons reveals with no repaint. Skipping it starved
      // the views of their own tiles (the "no tiles until toggled back" bug).
      const arrival = await this.#arrivalGate(passSegments, locationKey !== this.renderedLocationKey)
      if (arrival === 'abandon') return
      return await this.#renderFromSynchronizeInner(lineage, locationKey, axial, passSegments)
    } finally {
      if (this.#activeRenderTarget === locationKey) this.#activeRenderTarget = null
      // PUT THE HOVER BACK. Clearing it above is only correct for the DURATION
      // of the pass — the index it names is stale while the map is being
      // replaced. Leaving it cleared afterwards was the collapse: the pointer
      // has not moved, so the overlay keeps the tile's icons on screen (two
      // rows of them), while the renderer, told nothing is hovered, drops the
      // band back to the resting one-row pill underneath them. Recovery used to
      // depend entirely on a round trip — render:cell-count → the overlay's
      // #recoverHover → tile:hover — which a pass that bails, or one whose
      // recovery is refused mid-navigation, never completes. Re-deriving from
      // the label we already hold needs no round trip and is correct whatever
      // the pass did: by now #hoverRevealLabel is either the tile still under
      // the cursor, or null because the level it belonged to is gone.
      this.#applyHover(this.#hoverRevealLabel)
    }
  }

  /** ORDERING, not suppression: may this pass paint yet?
   *
   *  'paint'   — go ahead (the normal case; on a default-view layer this
   *              means the verdict has landed and the surface has already
   *              flipped, so the paint lands under the mounted view).
   *  'abandon' — the participant navigated away while the gate waited; a
   *              newer pass owns the render, touch nothing.
   *
   *  The mark is read synchronously from the warm decoration index — every
   *  in-hive navigation warmed it when the parent page hydrated this cell.
   *  A NAVIGATION pass whose index comes up empty pays one async decoration
   *  read to be sure: the index holds no negative entries, and the ROOT is
   *  never in it at all (segments = [] signs the root location, the one
   *  place the child-hydration walks can never warm) — mid-session arrivals
   *  at the root were exactly the flash the boot-only probe missed.
   *  Invalidation passes at an unchanged location skip the read.
   *
   *  The OPEN decision stays with view.bee — its verdict inherits every
   *  gate (dormant, hidden, scope, roster). Holding the paint for it is
   *  what makes the arrival seamless: the splash's first ready signal is
   *  the verdict, the view mounts, and only then do the hexagons paint —
   *  invisibly, under the covered canvas, keeping the tile roster and the
   *  hydration walk fed and the escape-to-hexagons instant. */
  async #arrivalGate(passSegments: readonly string[], isNavigation: boolean): Promise<'paint' | 'abandon'> {
    // THE CASCADE: own mark or the nearest ancestor's — a branch default
    // covers every page under it, so the gate must hold on those pages too.
    // An explicit `hexagons` mark is the opt-out: the hexagons ARE the
    // surface here, so paint straight away.
    let want = defaultViewWithinSegments(passSegments)
    if (!want && isNavigation) {
      want = await defaultViewWithinAt(passSegments)
      if (!this.#segmentsAreCurrent(passSegments)) return 'abandon'
    }
    if (!want || want === HEXAGONS_SURFACE) return 'paint'
    const vm = get<{ mode: string; is(name: string): boolean }>('@hypercomb.social/ViewMode')
    if (!vm || vm.is(want)) return 'paint'
    // The mark says a view opens here but the arbiter has not ruled for THIS
    // address yet — hold the paint until the verdict lands (or the timeout
    // releases it). Whatever the verdict says, painting is then correct:
    // opened → under the view; declined → the hexagons ARE the surface.
    // Last-value replay makes an already-emitted verdict resolve
    // synchronously.
    await this.#awaitArrivalVerdict(passSegments)
    if (!this.#segmentsAreCurrent(passSegments)) return 'abandon'
    return 'paint'
  }

  /** Resolves when view.bee announces the arrival verdict for `segments`,
   *  or after ARRIVAL_GATE_MS. Verdicts for other addresses (a stale
   *  replay, a racing navigation) are ignored — only a matching one, of
   *  either outcome, releases the gate early. */
  #awaitArrivalVerdict(segments: readonly string[]): Promise<void> {
    return new Promise<void>(resolve => {
      let done = false
      let unsub: (() => void) | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (): void => {
        if (done) return
        done = true
        unsub?.()
        if (timer) clearTimeout(timer)
        resolve()
      }
      unsub = EffectBus.on<{ segments?: readonly string[] }>('view:arrival', p => {
        const got = p?.segments
        if (!Array.isArray(got) || got.length !== segments.length) return
        for (let i = 0; i < segments.length; i++) {
          if (String(got[i]) !== String(segments[i])) return
        }
        finish()
      })
      if (!done) timer = setTimeout(finish, ARRIVAL_GATE_MS)
    })
  }

  // The body of renderFromSynchronize, factored out so the dedup wrapper
  // above stays readable. All the existing logic lives here unchanged.
  readonly #renderFromSynchronizeInner = async (lineage: any, locationKey: string, axial: any, passSegments: readonly string[]): Promise<void> => {
    // Re-narrow pixi handles. The outer renderFromSynchronize already
    // guarded these but TS can't carry the narrowing across the function
    // boundary. Cheap re-check.
    if (!this.pixiApp || !this.pixiContainer || !this.pixiRenderer) {
      this.clearMesh("synchronize: pixi handles lost")
      return
    }

    // Refresh peer-presence glow once per pass so any cell built below
    // (full, streamed, or incremental) reads a current crowd count.
    this.#refreshPresenceGlow()

    // note: init layer + atlases (and reset shader if renderer changes)
    if (!this.layer) {
      this.layer = new Container()
      this.pixiContainer.addChild(this.layer)

      // 16×16 = 256 slots — MUST be >= the imageAtlas slot count (and >= the
      // realistic on-screen tile count) so hives larger than 64 tiles do NOT
      // wrap the label atlas. Wrapping bumps evictionGeneration, which
      // applyGeometry checks against #bakedLabelAtlasGen, so every wrap defeats
      // its early-return → the whole grid re-bakes its labels on EVERY render
      // pass (O(tiles) thrash). At 64 slots a 79-tile hive thrashed
      // continuously; at 256 it builds once and the cache holds.
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 16, 16)
      this.attachLabelResolver(this.atlas)
      this.atlas.setPivot(this.#pivot)
      if (this.#warmLabels.length) this.atlas.seed(this.#warmLabels)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 16, 16)
      this.shader = null
      this.#primeEmptyRenderPipeline()
      this.#faces.clear()
      this.atlasRenderer = this.pixiRenderer
    } else if (!this.atlas || this.atlasRenderer !== this.pixiRenderer) {
      // 16×16 = 256 slots — MUST be >= the imageAtlas slot count (and >= the
      // realistic on-screen tile count) so hives larger than 64 tiles do NOT
      // wrap the label atlas. Wrapping bumps evictionGeneration, which
      // applyGeometry checks against #bakedLabelAtlasGen, so every wrap defeats
      // its early-return → the whole grid re-bakes its labels on EVERY render
      // pass (O(tiles) thrash). At 64 slots a 79-tile hive thrashed
      // continuously; at 256 it builds once and the cache holds.
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 16, 16)
      this.attachLabelResolver(this.atlas)
      this.atlas.setPivot(this.#pivot)
      if (this.#warmLabels.length) this.atlas.seed(this.#warmLabels)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 16, 16)
      this.shader = null
      this.#primeEmptyRenderPipeline()
      this.#faces.clear()
      this.atlasRenderer = this.pixiRenderer
    }

    // THE SAME-NAME / DIFFERENT-LINEAGE BOUNDARY. The caches below are keyed
    // by label for hot render-loop access, but a label is not an appearance
    // address. Without this reset, adding `/team/jaime` with a new picture can
    // repaint `/friends/jaime`, and the warm back-nav path then writes the
    // second picture into the first page's cached cell. Titles share the same
    // raw-label atlas key, so flush glyphs in the same transaction.
    this.#faces.enter(locationKey, this.#layerCellsCache.has(locationKey))

    // ── back-nav fast path ─────────────────────────────────
    // SYNCHRONOUS restore. We have everything in memory; awaiting OPFS
    // reads or atlas decodes for cells whose data we already cached
    // turns "show 3 tiles you saw 2 seconds ago" into 400ms of latency.
    // Every step here MUST be sync. Anything that needs async work (atlas
    // refill if a slot was evicted, viewport read if no snapshot) is
    // kicked off in the background and only triggers a re-render if it
    // produced new state.
    if (
      locationKey !== this.renderedLocationKey
      && !(this.#narrow.results && this.#narrow.results.length > 0)
    ) {
      const cached = this.#layerCellsCache.get(locationKey)
      // Sub-layer locations no longer mint OPFS folders (layer-primitive
      // doctrine), so `lineage.explorerDir()` returns null for them and
      // `#layerDirCache` is never populated. The fast path used to
      // require `cachedDir`, which silently disabled it for every
      // sub-layer back-click — every back to /alpha, /dolphin, etc.
      // hit the slow path (full layer fetch + cell stream + atlas refill)
      // when the user perceived the operation as just "redraw what was
      // there 2 seconds ago." Drop the cachedDir requirement and gate
      // the dir-dependent side effects (viewport OPFS read, vp.setDir,
      // image refill) on its presence below.
      const cachedDir = this.#layerDirCache.get(locationKey)
      // An empty page is still a completely cached page. Requiring at least
      // one cell sent back-navigation through the full async resolver even
      // though there was nothing to resolve or paint.
      if (cached) {
        // Capture the OUTGOING layer's live VP state into our cache so
        // a future return to that layer restores where the user actually
        // left it (pan/zoom/meshOffset they applied this session). VP's
        // OPFS write is debounced; the in-memory cache stays stale until
        // we explicitly sync it.
        this.#syncCacheFromVP(this.renderedLocationKey)
        // abort any stream still running for the previous layer
        ++this.#streamToken

        // Hide the OUTGOING layer BEFORE the new location's viewport is
        // applied. Without this the old tiles visibly RESIZE (the new
        // zoom/pan lands on the still-visible old content) and then
        // vanish when the cached cells swap in. Same ordering contract
        // as the slow layer-change path: old level out, then viewport,
        // then content, then reveal (:1745 below). In the all-sync case
        // the hide/show happens within one frame — no flicker.
        if (this.layer) this.layer.visible = false

        // Viewport: prefer the cached snapshot (sync). A visited page and a
        // prepared page both seed this cache. A legacy partial cache may lack
        // it; that must not turn Back into a storage read.
        let appliedSnap: ViewportSnapshot | null = null
        const vpSnap = this.#layerViewportCache.get(locationKey)
        if (vpSnap) {
          // appliedSnap must be what was ACTUALLY applied — the sanitizer
          // may have rejected components of the cached snapshot.
          appliedSnap = this.#applyViewportFromSnapshot(vpSnap)
        } else {
          // Keep the restore synchronous. A later slow refresh can populate
          // viewport state for this legacy/partial cache entry.
          appliedSnap = null
        }
        // Explicit set — never inherit from prior render. The back-nav
        // fast path's mesh ALREADY exists, so we only need to mark
        // recenter pending; the mesh.position was already set by
        // #applyViewportFromSnapshot when snap had a meshOffset.
        this.#pendingRecenter = !appliedSnap?.meshOffset
        this.#pendingFirstVisitFit = this.#preparedFirstVisitFit.delete(locationKey)

        const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
        // Tell VP which location it's reporting to. Viewport is keyed by
        // lineage segments in the sig-keyed __viewport__ store — works for
        // sub-layers without an OPFS dir and for root (segments=[] → '/').
        vp?.setCurrentLocation?.(lineage.explorerSegments?.() ?? [])

        this.renderedLocationKey = locationKey
        this.cachedCellNames = cached.cellNames
        this.cachedLocalCellSet = cached.localCellSet
        this.cachedBranchSet = cached.branchSet
        this.#layoutMode = this.#order.layoutMode(locationKey)
        this.#pendingRemoves.clear()
        // No auto-recenter. The mesh offset was saved alongside pan/zoom
        // when the user first loaded this layer (or when they explicitly
        // ran navigation.recenter). #applyViewportFromSnapshot above
        // restored snap.meshOffset onto hexMesh.position — that's the
        // single source of truth for where the mesh sits. Only the
        // explicit recenter command (fitToScreen)
        // sets pendingRecenter; layer change alone does not.
        this.renderedCells.clear()

        // SYNC restore per-cell properties from per-label caches. No
        // OPFS, no atlas decode. If a cell's atlas slot was evicted
        // while we were away, mark it for background top-up.
        const atlas = this.imageAtlas
        const evictedSigs: string[] = []
        let hasUnresolvedLocalImage = false
        for (const cell of cached.cells) {
          const label = cell.label
          // EXTERNAL cells restore with the imageSig they were cached
          // with (bound from the publisher's visuals). Top up from the
          // coherent label cache only when the cached object predates a
          // derivation, and queue eviction refills the same as local
          // cells — previously externals were skipped here, so an
          // atlas-evicted peer image never re-painted.
          if (cell.external) {
            if (!cell.imageSig) {
              const sig = this.#faces.images.get(label) ?? undefined
              if (sig) cell.imageSig = sig
            }
            if (cell.imageSig && atlas && !atlas.hasImage(cell.imageSig) && !atlas.hasFailed(cell.imageSig)) {
              evictedSigs.push(cell.imageSig)
            }
            this.renderedCells.set(label, cell)
            continue
          }
          if (this.#faces.images.has(label)) {
            const sig = this.#faces.images.get(label) ?? undefined
            cell.imageSig = sig
            cell.borderColor = this.#faces.borders.get(label)
            cell.hasLink = this.#faces.links.get(label) ?? false
            cell.hasSubstrate = this.#faces.substrates.get(label) ?? false
            cell.hideText = this.#faces.hiddenText.get(label) ?? false
            if (sig && atlas && !atlas.hasImage(sig) && !atlas.hasFailed(sig)) {
              evictedSigs.push(sig)
            }
          }
          // A cached null/absent derivation is not proof that the layer has no
          // picture. It may be the stale-index state that edit+save repairs.
          // Back-nav used to refresh ONLY known sigs evicted from the atlas,
          // permanently excluding exactly these blank cells from healing.
          if (!cell.imageSig) hasUnresolvedLocalImage = true
          this.renderedCells.set(label, cell)
        }

        // Atlas slots are opportunistic. A child preload can reuse a parent's
        // slot while the parent is off-screen; that must not delay Back.
        if (this.layer) this.layer.visible = true

        // applyGeometry has no internal awaits; the `async` modifier
        // just wraps the return — the body runs synchronously. Don't
        // await it; one less microtask hop.
        void this.applyGeometry(cached.cells)
        this.renderedCellsKey = this.buildCellsKey(cached.cells)
        this.#slots.seed({
          names: cached.cellNames,
          localCells: cached.localCellSet,
          branches: cached.branchSet,
          mode: this.#layoutMode,
        })

        this.#narrow.emitRenderTags(cached.cells)
        // Stays AFTER applyGeometry deliberately. applyGeometry now publishes
        // the count itself, ahead of its restore-refit, which is what fixes the
        // ordering — but it early-returns before that emit on three paths (0
        // cells, unchanged cells-key, missing atlas), and back-nav hits the
        // unchanged-key bail routinely. This unconditional emit is the safety
        // net for those. Moving it BEFORE applyGeometry is wrong: listeners
        // that measure live bounds (the control bar's global-fit `arrived`)
        // would then read the OUTGOING page's geometry.
        this.emitEffect('render:cell-count', { ...this.#buildCellCountPayload(cached.cells), settled: true })

        // Child preloading can reuse atlas slots that belonged to this parent.
        // Repair those slots after the cached paint, never between the Back
        // gesture and that paint. Repaint only if the parent is still visible.
        if (evictedSigs.length > 0 || hasUnresolvedLocalImage) {
          void (async () => {
            try {
              // Force image-less cache entries through the canonical layer
              // check in loadCellImages instead of returning the remembered
              // null before reaching the slow resolver.
              const force = hasUnresolvedLocalImage
                ? new Set(cached.cells.filter(c => !c.external && !c.imageSig).map(c => c.label))
                : undefined
              await this.loadCellImages(cached.cells, cachedDir ?? null, force)
              if (this.renderedLocationKey === locationKey) {
                await this.applyGeometry(cached.cells, true)
              }
            } catch { /* cached text paint remains usable */ }
          })()
        }

        // background: refresh cursor for undo/redo readiness. Renderer
        // doesn't need it to draw — cells are already filtered.
        void (async () => {
          try {
            const cursorService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
            if (!cursorService) return
            const sigLoc = await this.computeSignatureLocation(lineage)
            if (sigLoc.sig) await cursorService.load(sigLoc.sig)
          } catch { /* best-effort */ }
        })()

        return
      }
    }

    const fsRev = Number(lineage.changed?.() ?? 0)
    const meshRev = this.#mesh.rev

    const isStale = (): boolean => {
      const currentKey = String(lineage.explorerLabel?.() ?? '/')
      const currentRev = Number(lineage.changed?.() ?? 0)
      const currentMeshRev = this.#mesh.rev
      return currentKey !== locationKey || currentRev !== fsRev || currentMeshRev !== meshRev
    }

    // Read-only explorer dir lookup. Layer-as-primitive — hierarchy
    // lives in layer.children, not in `hypercomb.io/<path>/` folders.
    // The renderer no longer mints folders to hold viewport state;
    // viewport persistence lives keyed by lineageSig (flat), not by
    // a parallel folder tree. A null dir is the new normal for any
    // sub-layer location.
    const dir: FileSystemDirectoryHandle | null = await lineage.explorerDir()
    if (isStale()) {
      this.renderQueued = true
      return
    }
    // Layer-as-primitive: a missing OPFS dir is the new normal — tile
    // membership lives in the lineage's history bag, not on disk. Sub-
    // layer locations that don't have a `__hive__/...` mirror still need
    // to render from `layer.children`. The old `if (!dir) return` bail
    // was the path that turned /dolphin (and every other sub-layer)
    // into a blank canvas after the OPFS-dir migration.
    //
    // Downstream code that genuinely requires `dir` (image loaders,
    // viewport persistence per dir) is gated on its presence — null
    // dir means "no on-disk shortcut, fall back to layer-only resolve."
    if (dir) {
      // populate back-nav fast-path dir cache (only when we have a real dir)
      this.#layerDirCache.set(locationKey, dir)
    }

    // ── tag flatten override ──────────────────────────────
    // The filter FOLLOWS you: entering a match re-roots the walk at wherever
    // you landed, so the flatten narrows as you drill in rather than redrawing
    // the same set at every level. A moved location means the scan is stale.
    // A GATHERED SET is only ever the view you raised it from. Clicking one of
    // its tiles travels to that tile's real home — and the audit is over, so
    // the gather clears rather than following you there and painting the same
    // set again at the destination.
    // The narrowing settles first: a gather left behind clears, a lens that
    // moved with you re-scans, and the last flatten's paths are dropped so an
    // ordinary page can never inherit them (tile-narrowing.ts settle).
    await this.#narrow.settle()

    // An active filter that matched nothing in scope shows an EMPTY mesh — not
    // a silent fall-through to the unfiltered page. We deliberately skip
    // emitting render:tags here so the last tag list (with the active filter pill)
    // stays on screen, leaving a way to clear the filter.
    if (this.#narrow.active && this.#narrow.results && this.#narrow.results.length === 0) {
      this.clearMesh('tag-filter: no matches in scope')
      this.renderedCellsKey = this.#narrow.renderKey()
      this.renderedLocationKey = locationKey
      this.renderedCells.clear()
      this.emitEffect('render:cell-count', { ...this.#buildCellCountPayload([]), settled: true })
      return
    }

    // When tag filter is active, use pre-scanned cross-page results instead of explorer
    if (this.#narrow.results && this.#narrow.results.length > 0) {
      const flatResults = this.#narrow.results
      const cellNames = flatResults.map(r => r.label)
      const flatSeedSet = new Set(cellNames)

      const axial = this.resolve<any>('axial')
      if (!axial) return

      // A flattened match keeps its structural truth: a tile with children still
      // renders as a branch, so a filter never turns a parent into a leaf whose
      // click opens the editor. Entering it is gated separately (below) on
      // whether the subtree actually holds a match.
      const flatBranchSet = new Set(flatResults.filter(r => r.hasChildren).map(r => r.label))
      this.#narrow.adopt(flatResults)

      const maxCells = Math.min(cellNames.length, typeof axial.items.size === 'number' ? axial.items.size : cellNames.length)
      const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, flatSeedSet, flatBranchSet)
      if (cells.length === 0) { this.clearMesh(`flat-seed: axial yielded 0 cells (names=${cellNames.length})`); return }

      // load images (best-effort). Runs even when dir is null —
      // loadCellImages only needs the dir for tags/link reads (already
      // null-tolerant), and EXTERNAL (peer) tiles resolve images purely
      // from the swarm's streamed sigs + __resources__. Gating on dir
      // left a witness refreshing at a foreign location (no local dir)
      // with permanently imageless tiles.
      await this.loadCellImages(cells, dir)

      this.cachedCellNames = cellNames
      this.cachedLocalCellSet = flatSeedSet
      this.cachedBranchSet = flatBranchSet
      // The scan root is part of the identity of a flatten now — without it a
      // drill-down into a match would reuse the parent level's geometry.
      this.renderedCellsKey = this.#narrow.renderKey()
      this.renderedLocationKey = locationKey

      this.renderedCells.clear()
      for (const cell of cells) this.renderedCells.set(cell.label, cell)
      await this.applyGeometry(cells)

      this.#narrow.emitRenderTags(cells)
      // Listeners (TileSelection, TileOverlay) crash on undefined coords
      // when payload omits them. Send the full shape via the helper.
      this.emitEffect('render:cell-count', { ...this.#buildCellCountPayload(cells), settled: true })
      return
    }

    // Tile membership is layer-only (project_layer_is_primitive). The
    // layer's children slot is the sole source of truth for "what tiles
    // exist at this location". OPFS dirs at hypercomb.io/<name>/ are a
    // retired artifact of the legacy add path; they may still exist
    // from old sessions but the render path no longer consults them.
    //
    // localCells stays empty here. It gets populated below from the
    // layer's children once the cursor + history are resolved. Same
    // identifier kept so the rest of the render path (which uses it as
    // "what's owned here") doesn't need to be rewritten.
    const localCells: string[] = []
    if (isStale()) {
      this.renderQueued = true
      return
    }

    // ATOMIC MEMBERSHIP — `union` starts EMPTY and is filled from the LAYER
    // only (a render = the current layer's children, nothing else). The
    // legacy meshCells seed was REMOVED here: it injected the PREVIOUS
    // location's peers across a navigation (meshCells is repopulated async
    // by TileMesh.refresh, so on a fresh nav it still held the old sig's
    // cells), and clearMesh never cleared it — a cross-location leak. Swarm
    // peers now arrive solely through the TileSourceRegistry preview path
    // below, which is location-scoped by `segments`, so a peer for /A is
    // structurally absent from /B's resolve.
    const union = new Set<string>()

    const localCellSet = new Set<string>()

    // Preview tile sets — populated AFTER the layer-filter block runs
    // (~line 1750+). Why: dedup against localCellSet has to happen on
    // the post-filter set, otherwise a peer tile whose name matches
    // an OPFS dir that the layer says "doesn't render" gets dropped
    // from BOTH the local pass (because it's in OPFS) AND the layer
    // pass (because the layer wiped localCellSet). The user then sees
    // neither — even though the swarm has the data.
    const ephemeralCellSet = new Set<string>()
    const peerCellSet = new Set<string>()

    // branchSet holds names whose tile has its own sub-tiles (so a
    // click drills in instead of opening the editor). Starts empty;
    // populated from layer sublayers once the cursor's content is
    // resolved below. The old OPFS-walking #computeBranchSet path is
    // retired — branches are a property of the merkle tree, not OPFS.
    let branchSet: Set<string> = new Set()

    // note: apply history — filter out cells whose last operation is "remove"
    // When a cursor is rewound, also compute divergence (future adds/removes)
    // Skip when clipboard view is active — clipboard labels are authoritative
    const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    const cursorService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
    this.#divergenceFutureAdds = new Set<string>()
    this.#divergenceFutureRemoves = new Set<string>()
    this.#cursorPropsOverride = null
    this.#cursorReconstructionKey = ''
    // Names listed in the cursor's current layer's `children` slot. When
    // available, this is the authoritative membership for the location —
    // both at REWOUND (replace union outright) and at HEAD (used to
    // reconcile pendingRemoves against layer truth, so layer-only deletes
    // honored and layer-restoring undos drop stale pending entries).
    let layerAllowed: Set<string> | null = null
    // Completeness-gate state, read after the layer block below. Default
    // to "complete" so clipboard / empty / non-layer paths never gate —
    // only the layer-content path flips these when a resolution is partial.
    let childResolveComplete = true
    let childResolveExpected = 0
    let gateParentSig = ''
    // Full child sigs that failed to resolve this pass — painted as
    // unavailable-placeholders when the completeness gate exhausts.
    let childResolveUnresolved: string[] = []
    // Source-diagnostic: children count from the memoized currentLayer()
    // (srcStaleLen) vs the fresh head sig (srcFreshLen). A divergence is the
    // "stale content" two-stage path (renders the subset, then the full set).
    let srcStaleLen = -1
    let srcFreshLen = -1
    if (historyService) {
      const sig = await this.computeSignatureLocation(lineage)

      // Real-time supersedes preloader: cursor.load runs a bag scan +
      // warmupHistoricalResources walk that can take 600ms-1.5s on a
      // 100-marker lineage — and the ROOT bag gains a marker on every
      // change made anywhere, so at root this is the whole edit history.
      // Fire-and-forget is NOT enough: its hundreds of OPFS reads, JSON
      // parses, and hash continuations share the main thread and the
      // OPFS backend with the critical render, stretching every awaited
      // hop of first paint. Defer the kick to IDLE so the render wins
      // the thread; the user only feels cursor cost when they invoke
      // /undo or open the history viewer.
      if (cursorService && sig.sig) {
        const cursorSig = sig.sig
        const kick = () => { void cursorService.load(cursorSig).catch(() => {}) }
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
        if (typeof ric === 'function') ric(kick, { timeout: 4000 })
        else setTimeout(kick, 1500)
      }

      if (cursorService) {
        // Primary content source: lineage.currentLayer() is memoized per
        // fsRevision and returns in <1ms from in-memory state. It IS the
        // live layer for the current location at HEAD. The cursor path
        // is only consulted when the user has actively rewound.
        let content: LayerContent | null = null
        // Did currentLayer() actually RESOLVE (vs throw)? A definitive
        // "no layer here" (resolved → null) means the location owns zero
        // tiles, and we must clear the union seed below so a freshly-
        // navigated empty location doesn't inherit the previous one's
        // tiles. A THROW (transient lineage hiccup) leaves state untouched
        // so we never blank a populated location on a momentary error.
        let layerLookupSucceeded = false
        try {
          const live = await (lineage as { currentLayer?: () => Promise<LayerContent | null> }).currentLayer?.()
          layerLookupSucceeded = true
          if (live && typeof (live as { name?: unknown }).name === 'string') {
            content = live as LayerContent
          }
        } catch { /* lineage unavailable — fall through to cursor */ }

        // Rewound view: if the user has scrubbed history (cursor.position
        // < cursor.total) the cursor points at a historical layer and
        // overrides the live content. cursorState is only meaningful when
        // cursor.load has already completed for this location — typically
        // true because the user spent time here before rewinding. On a
        // freshly-navigated-to location the cursor's state is zeroed
        // (position=0, total=0) which is NOT rewound, so live content wins.
        const cursorState = cursorService.state
        const isRewound = (cursorState?.total ?? 0) > 0
          && (cursorState?.position ?? 0) < (cursorState?.total ?? 0)
        if (isRewound) {
          const cursorContent = await cursorService.layerContentAtCursor().catch(() => null)
          if (cursorContent) {
            content = cursorContent
          } else if ((cursorState?.position ?? 0) === 0) {
            // Pre-history view (case A from the previous implementation):
            // user has rewound past every marker. Render empty.
            content = null
            union.clear()
            localCellSet.clear()
          }
        }

        // PRUNE MODE — the layer of deleted tiles (history/prune.service.ts).
        //
        // Same seam as rewinding, and for the same reason: a layer is just
        // `{name, children}`, so "the tiles this location threw away" IS a
        // layer and the entire pipeline below — child-name resolution,
        // images, layout, hit-testing — works on it unchanged. Nothing here
        // knows what prune mode is beyond "somebody handed me a different
        // layer", which is the only way a mode should ever reach a renderer.
        //
        // Placed AFTER the rewind branch so scrubbing history while pruning
        // cannot half-apply: the deleted layer is what you are standing on
        // until you leave the mode.
        const pruneService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/PruneService') as
          { active?: boolean; names?: readonly string[]; layerFor?: (locationSig: string) => LayerContent | null } | undefined
        let pruneLayerActive = false
        if (pruneService?.active && pruneService.layerFor) {
          const prunedLayer = pruneService.layerFor(sig.sig)
          if (prunedLayer) {
            content = prunedLayer
            pruneLayerActive = true
            union.clear()
            localCellSet.clear()
            // These tiles are gone — paint them with the treatment that
            // already means exactly that (divergence 2, "future-remove").
            // The mode borrows the existing visual vocabulary rather than
            // minting a ghost of its own.
            this.#divergenceFutureRemoves = new Set(pruneService.names ?? [])
          }
        }

        if (content) {
          // Layer-as-primitive: the layer's children list is the truth at
          // every position (HEAD and REWOUND alike). Cells in OPFS but not
          // in the layer are layer-removed (e.g. /remove just landed) and
          // must not render; cells in the layer but not in OPFS are still
          // imported so the merkle-stored content is recoverable.
          //
          // The cell:added incremental path (#queueIncremental) handles
          // the brief window between user-action and cascade-landing — new
          // cells render immediately via the slot machine before the next
          // computeRender re-fires from cursor.onNewLayer.
          const parentSegments = (lineage as { explorerSegments?: () => readonly string[] })?.explorerSegments?.() ?? []
          // parentLayerSig MUST be the parent layer's CONTENT sig — that is
          // the key commitLayer writes the children-manifest under
          // (__manifests__/<layerContentSig>). Prefer the cursor's
          // currentLayerSig (already the content sig; points at the
          // historical layer when rewound). When the cursor hasn't loaded
          // yet — its load is deferred to idle, so this is the COMMON case
          // on first paint — fall back to history's head sig for this
          // location, NOT lineage.currentSig(): currentSig() returns the
          // LOCATION/lineage sig, a DIFFERENT value. Reading the manifest
          // under the location sig misses on every first render, dropping
          // to the per-child path that loses not-yet-cached children — the
          // "renders 10, then 13 a second later" bug. latestMarkerSigFor is
          // a hot cache hit here: currentLayer() above already warmed
          // #latestSigByLineage for this location.
          // CROSS-LOCATION SAFETY: cursor.currentLayerSig is authoritative
          // ONLY when REWOUND (it points at the historical layer being
          // viewed). At HEAD its idle-deferred load LAGS a fresh navigation,
          // still pointing at the location we came FROM — which mis-keys the
          // memo and the manifest and renders the previous location's tiles
          // (the cross-location leak). At HEAD, read the CURRENT location's
          // head sig below (latestMarkerSigFor — a hot cache hit, location-
          // correct), never the cursor sig.
          let parentLayerSig: string = isRewound ? (cursorService.currentLayerSig || '') : ''
          // The pass's LOCATION sig — the same source (currentSig) that picked
          // `content`, so it always matches the cells this pass paints. The
          // children-readiness seed keys on THIS, never on segments/labels,
          // whose update can straddle the navigation (the memo-wipe bug).
          let passLocSig = ''
          try {
            passLocSig = await (lineage as { currentSig?: () => Promise<string> }).currentSig?.() ?? ''
          } catch { /* leave empty — seed skipped, compute seeds instead */ }
          // The prune layer is SYNTHETIC — it was never committed, so it has
          // no head sig and no children manifest. Leaving parentLayerSig as
          // the location's real head would key both the manifest and the
          // complete-child-names memo under a layer that is NOT the one being
          // rendered: when the deleted set happens to be the same SIZE as the
          // live set, the memo's size guard passes and the hive paints the
          // LIVE tiles while standing on the deleted layer (observed with one
          // ghost and one live tile). An empty sig is the honest answer — no
          // memo read, no manifest read, no memo write; resolve per child.
          if (pruneLayerActive) parentLayerSig = ''
          else if (!parentLayerSig && passLocSig && historyService?.latestMarkerSigFor) {
            try {
              const label = String((lineage as { explorerLabel?: () => string }).explorerLabel?.() ?? '/')
              parentLayerSig = await historyService.latestMarkerSigFor(passLocSig, label) ?? ''
            } catch { /* leave empty */ }
          }
          // SOURCE DIAGNOSTIC ONLY — record the memoized currentLayer() child
          // count. An earlier "upgrade `content` to getLayerBySig(parentLayerSig)"
          // guard was REMOVED here: parentLayerSig prefers cursor.currentLayerSig,
          // whose cursor.load is idle-DEFERRED, so right after a navigation it
          // still points at the PARENT location. Reading its layer replaced the
          // child's content with the parent's — rendering the parent's tiles at
          // the child location, and the just-left layer's tiles after navigating
          // back ("tiles left behind after navigate"). currentLayer() resolves
          // currentLayerAt(currentSig()) and is LOCATION-correct; trust it. Any
          // future stale-content fix must read the CURRENT location's head
          // (latestMarkerSigFor(currentLocSig)), never a cross-location sig.
          srcStaleLen = Array.isArray(content.children) ? content.children.length : 0
          srcFreshLen = srcStaleLen
          // Record the parent sig so the completeness gate below can key
          // its retry budget on the LAYER (content), not the location.
          gateParentSig = parentLayerSig
          // Children-readiness seed — keyed by the pass's LOCATION SIG
          // (currentSig — the source that picked `content`, so it matches
          // the painted cells even mid-popstate). Never by segments/labels
          // (they straddle navigations → memo wipes) and never by this
          // pass's parentLayerSig (cursor-derived, can lag). Seeding before
          // the shade bits bake means a revisited page paints bright on its
          // FIRST frame — each page shades at most once per session.
          // TileReadiness.compute validates the memo against the real
          // parent sig and drops it only when content actually changed.
          if (CHILD_SHADE && passLocSig) {
            // Stamp the pass's address for the readiness compute: the location
            // sig that picked `content`, the segments that name it, and the
            // head layer whose children we will prove. The compute reads THESE
            // — never lineage — so its keys always describe the cells this
            // pass painted.
            let passSegments: readonly string[] = []
            try {
              passSegments = ((lineage as { explorerSegments?: () => readonly string[] }).explorerSegments?.() ?? [])
                .map(s => String(s ?? '').trim()).filter(Boolean)
            } catch { /* no segments: the root */ }
            this.#readiness.stamp(passLocSig, parentLayerSig, passSegments)
          }
          childResolveExpected = Array.isArray(content.children) ? content.children.length : 0
          // Warm-path memo: a prior COMPLETE resolution under this exact
          // parent content sig is authoritative — the child set can't have
          // changed without the sig changing. Read the full membership —
          // names AND branch-status — with ZERO per-child lookups. Only a
          // partial (cold) pass ever touches resolveChildNames, and only a
          // complete pass writes the memo.
          const branchSetFromResolve = new Set<string>()
          const memoRaw = parentLayerSig ? this.#completeChildNamesByParentSig.get(parentLayerSig) : undefined
          // Defense-in-depth: a memo entry is valid only if its size matches
          // THIS layer's child count. Guards against a mis-keyed entry (a
          // stale cross-location sig) ever returning another location's
          // children — the leak is then a cache miss, not wrong tiles.
          const memo = (memoRaw && memoRaw.names.length === childResolveExpected) ? memoRaw : undefined
          if (memo) {
            layerAllowed = new Set(memo.names)
            for (const b of memo.branches) branchSetFromResolve.add(b)
            childResolveComplete = true
          } else {
            const stats: {
              expected: number
              resolved: number
              unresolvedSigs: string[]
            } = { expected: 0, resolved: 0, unresolvedSigs: [] }
            const branchStats = { cold: false }
            const membershipGenerationAtStart = this.#membershipGeneration
            // branchSetFromResolve is filled in the SAME pass that resolves
            // names — one read, no separate per-child branch walk. branchStats
            // reports separately whether any child's branch-STATUS came back on
            // a cold pool miss (see freshenBranches) — names can be complete
            // while branch-status is not.
            layerAllowed = await resolveChildNames(
              historyService,
              parentSegments,
              dir,
              content,
              parentLayerSig,
              stats,
              branchSetFromResolve,
              branchStats,
              {
                mayUpgradePack: true,
                onBranchesFreshened: fresh => {
                  if (!parentLayerSig) return
                  const prepared = this.#completeChildNamesByParentSig.get(parentLayerSig)
                  if (!prepared) return
                  const old = new Set(prepared.branches)
                  if (old.size === fresh.size && [...fresh].every(name => old.has(name))) return
                  this.#completeChildNamesByParentSig.set(parentLayerSig, {
                    names: prepared.names,
                    branches: [...fresh],
                  })
                  // The repair ran after paint. If the participant is still on
                  // this location, one targeted pass updates branch dots and
                  // click routing; otherwise the corrected memo is ready for
                  // the next visit. Never put the head walk back on navigation.
                  if (this.renderedLocationKey === locationKey) {
                    this.#forceNextRender = true
                    this.requestRender()
                  }
                },
              },
            )
            // Complete iff every child sig produced a name. expected===0 is
            // a (trivially complete) empty layer.
            childResolveComplete = stats.expected === 0 || stats.resolved >= stats.expected
            childResolveUnresolved = stats.unresolvedSigs
            // A complete NAME set does NOT mean branch-status is settled: a
            // child's head bytes can be cold while its name resolved from the
            // manifest. Only memoize when BOTH are settled — caching a cold
            // branch set under this parent sig would re-serve a missing branch
            // dot on every later render at this location and lock the tile out
            // of navigation (the same poison the per-headSig guard in
            // freshenBranches prevents). When branch-status is cold, schedule a
            // bounded, NON-blocking re-render so the dot fills in this visit;
            // the layer still paints now — a missing dot is not a missing tile,
            // so we never hold the paint the way the name gate does.
            const branchComplete = !branchStats.cold
            // Membership moved under this pass: its answer predates an add or
            // remove, so it must not become the memo (see #membershipGeneration).
            const membershipStill = membershipGenerationAtStart === this.#membershipGeneration
            if (childResolveComplete && branchComplete && membershipStill && parentLayerSig && stats.expected > 0) {
              const names: string[] = []
              for (const n of layerAllowed) if (typeof n === 'string' && n.length > 0) names.push(n)
              // Bound: evict oldest (Map keeps insertion order) past a cap so
              // a long session of distinct layer sigs can't grow this without
              // limit. Each entry is keyed by an immutable content sig.
              if (this.#completeChildNamesByParentSig.size > ShowCellDrone.#PREPARED_VIEW_CAP) {
                const oldest = this.#completeChildNamesByParentSig.keys().next().value
                if (oldest !== undefined) this.#completeChildNamesByParentSig.delete(oldest)
              }
              this.#completeChildNamesByParentSig.set(parentLayerSig, { names, branches: [...branchSetFromResolve] })
              this.#preparedViewPath.set(parentLayerSig, this.#readiness.passSegments.join('/'))
            }
            if (parentLayerSig) {
              if (branchComplete) {
                this.#branchColdRetries.delete(parentLayerSig)
              } else {
                const n = (this.#branchColdRetries.get(parentLayerSig) ?? 0) + 1
                if (n <= ShowCellDrone.#BRANCH_COLD_MAX_RETRIES) {
                  this.#branchColdRetries.set(parentLayerSig, n)
                  this.#forceNextRender = true
                  setTimeout(() => this.requestRender(), Math.min(500, 100 * n))
                }
              }
            }
          }
          // Layer is the only source of truth (project_layer_is_primitive).
          // Whatever resolveChildNames returns IS the tile membership at
          // this location — empty layer means zero owned tiles, broken
          // layer means zero owned tiles. There is no OPFS fallback;
          // OPFS dirs are retired artifact storage and the render path
          // ignores them entirely. If a layer is corrupt the right
          // remedy is to fix it through the history pipeline, not to
          // fake-show OPFS contents that may be drift.
          const validNames: string[] = []
          for (const n of layerAllowed) {
            if (typeof n === 'string' && n.length > 0) validNames.push(n)
          }
          union.clear()
          localCellSet.clear()
          for (const cell of validNames) {
            union.add(cell)
            localCellSet.add(cell)
          }
          layerAllowed = new Set(validNames)

          // Branch-set comes from the SAME resolution that produced names —
          // populated by resolveChildNames from each child's `children` array
          // length (manifest hit OR the one-time cold per-child build), and
          // memoized alongside names. The old separate per-child
          // getLayerBySig walk — which re-loaded every child on EVERY render,
          // even on a manifest hit — is GONE. The render now loads the
          // current layer + its manifest, and never a child layer at draw
          // time.
          branchSet = branchSetFromResolve
        } else if (layerLookupSucceeded && !isRewound) {
          // Layer-as-primitive: a location with no committed layer owns
          // ZERO tiles. Clear the union seed — legacy meshCells (seeded
          // ~line 1927) plus any carry-over — so navigating INTO an empty
          // location starts from a clean slate instead of surfacing the
          // PREVIOUS location's tiles. This is the common swarm path:
          // exploring a peer's tile (or your own) that has no children
          // yet. Without this, the `if (content)` branch above never runs
          // and the old location's mesh cells leak in for a frame ("wrong
          // / leftover tiles"). Peer previews for THIS location are
          // re-added from the TileSourceRegistry block below.
          union.clear()
          localCellSet.clear()
          layerAllowed = new Set<string>()
        }
      }
    }

    // ── COMPLETENESS GATE ────────────────────────────────────────────
    // Never paint a PARTIAL child set. If the layer's children didn't all
    // resolve to names this pass (cold pool / sync still landing), the
    // visible "first render" would show fewer tiles than the layer holds
    // and then jump to the full count when the rest warm — the two-stage
    // load. Suppress the partial: hold the current view (on a nav the
    // OUTGOING layer is still up — we haven't reached the layer-change
    // block that hides it; on cold boot the canvas is simply still empty),
    // warm the missing children, and re-render. Bounded PER PARENT SIG so
    // a genuinely-absent child can never blank the canvas forever.
    if (!childResolveComplete && childResolveExpected > 0) {
      const gateKey = gateParentSig || locationKey
      const heldFor = this.#gateHoldAge(locationKey)
      if (!this.#resolveGateExhausted.has(gateKey)) {
        const attempts = (this.#incompleteResolveAttempts.get(gateKey) ?? 0) + 1
        this.#incompleteResolveAttempts.set(gateKey, attempts)
        if (attempts <= ShowCellDrone.#RESOLVE_GATE_MAX_ATTEMPTS && heldFor <= ShowCellDrone.#RESOLVE_GATE_HOLD_MS) {
          this.#recordRenderAudit('gate', union.size, locationKey)
          if (DIAG) console.info(`[diag:childres] GATE hold loc=${locationKey} attempt=${attempts}/${ShowCellDrone.#RESOLVE_GATE_MAX_ATTEMPTS} expected=${childResolveExpected} got=${union.size} — deferring partial`)
          // Force the next render past the fast-path skip and re-render with a
          // short backoff so the missing bytes land. Missing children resolve
          // ON DEMAND by signature (direct pool reads) — we do NOT brute-force
          // preloadAllBags here; a full-hive scan on a partial render is the
          // O(N) trap we removed. The retry re-attempts the direct reads as the
          // neighbourhood warms.
          this.#forceNextRender = true
          setTimeout(() => this.requestRender(), Math.min(400, 60 * attempts))
          return
        }
        // Budget exhausted — stop gating this layer so it can't thrash the
        // render loop, then fall through to paint what resolved.
        this.#resolveGateExhausted.add(gateKey)
        console.warn(`[diag:childres] GATE exhausted loc=${locationKey} after ${attempts} attempts / ${heldFor}ms expected=${childResolveExpected} got=${union.size} — painting placeholders for the missing`)
      }
      // Gate exhausted (this pass or a prior one). The unresolved children
      // are NOT dropped: paint each as an explicit unavailable-placeholder —
      // same hex cell, no image, sig-suffixed label so the user SEES the
      // tile exists while its content hasn't arrived. Placeholders join
      // `union` but never `localCellSet`, so they ride the existing
      // external-tile path end to end: dashed overlay treatment
      // (externalLabels), excluded from substrate assignment
      // (noImageLabels filters external), no per-tile index reads (the
      // index gate ignores non-local names), and never memoized — the
      // memo only writes on a COMPLETE resolution.
      if (childResolveUnresolved.length > 0) {
        for (const missingSig of childResolveUnresolved) {
          const label = `unavailable ${missingSig.slice(0, 8)}`
          union.add(label)
        }
        this.#placeholderLocations.add(locationKey)
        // content:missing — surface the unresolved sigs for future UI (a
        // re-push surface). Deduped per location on the exact sig set, so
        // repeated placeholder repaints don't spam subscribers.
        const emitKey = [...childResolveUnresolved].sort().join(',')
        if (this.#missingEmitKeyByLocation.get(locationKey) !== emitKey) {
          this.#missingEmitKeyByLocation.set(locationKey, emitKey)
          this.emitEffect('content:missing', { sigs: [...childResolveUnresolved], segments: [...passSegments] })
        }
        // Miss-window re-arm: if the broker is deliberately not fetching
        // one of these sigs until a miss window expires, schedule ONE
        // re-render shortly after the earliest expiry (coalesced timer —
        // never a polling loop). content:arrived remains the other re-arm.
        this.#armMissWindowRetry(childResolveUnresolved)
      }
    } else if (childResolveComplete && gateParentSig) {
      // Clean resolution — reset this layer's retry budget and drop the
      // placeholder bookkeeping so a later regression re-emits fresh.
      this.#incompleteResolveAttempts.delete(gateParentSig)
      this.#gateFirstHoldAt.delete(locationKey)
      this.#placeholderLocations.delete(locationKey)
      this.#missingEmitKeyByLocation.delete(locationKey)
    }

    // Now that localCellSet reflects layer-truth (or OPFS truth when no
    // layer constraint applies), pull peer/ephemeral previews from the
    // TileSourceRegistry. Doing this AFTER the layer block is what lets
    // a peer publishing a tile name that the local layer "doesn't have"
    // surface as a preview the user can adopt — without this ordering,
    // the dedup against the pre-filter localCellSet drops it before the
    // layer block ever runs.
    // Per-render map of peer-published slot indices. Built from any
    // kind:'peer' TileEntry that carries source.peerIndex. Passed into
    // the pinned-order resolver so peer tiles land at the publisher's
    // slot instead of being demoted to the next-free slot (which
    // collides with local cells at low indices).
    const peerIndices = new Map<string, number>()
    // Stacks are a derivation of THIS pass's peer entries. Reset before
    // resolving so a location with no publishers (or a registry that
    // isn't up yet) reads as unstacked instead of inheriting the last
    // location's multiplicity marks.
    const previousVariantLabels = new Set(this.#stackVariantLabels)
    this.#stackDepthByLabel = new Map()
    this.#stackVariantLabels = new Set()
    // Quiet: this is the pre-resolution reset, not a finding. Announcing it
    // would tell the depth ornaments every peer had left, a fifth of a second
    // before the real stacks land. See setTileStacks.
    setTileStacks(new Map(), { quiet: true })
    const previousVariantTitles = new Map(this.registryTitlesByLabel)
    this.registryPropertiesByLabel.clear()
    this.registryTitlesByLabel.clear()
    const registryVariantSeen = new Set<string>()
    try {
      const registry = (window as any).ioc?.get?.('@hypercomb.social/TileSourceRegistry') as
        | { resolve: (loc: { segments: readonly string[]; dir: FileSystemDirectoryHandle | null }) => Promise<readonly TileSourceProjection[]> }
        | undefined
      if (registry?.resolve) {
        const segs = lineage?.explorerSegments?.() ?? []
        // BOUNDED source resolution. Sources can dial the network (config
        // branches resolve layers/props through the broker), and awaiting
        // them unbounded let ONE slow source stall every render pass —
        // navigation must never wait on a tile source. Race against a
        // short budget: in time → render the live result; over budget →
        // render the last known entries for this location NOW and let the
        // resolve finish detached, re-rendering if it brings anything new.
        const srcKey = segs.join('/')
        const live = registry.resolve({ segments: segs, dir }).then((res) => {
          this.#sourceEntriesCache.set(srcKey, res)
          return res
        })
        const raced = await Promise.race([
          live,
          new Promise<null>((r) => setTimeout(() => r(null), ShowCellDrone.SOURCE_RESOLVE_BUDGET_MS)),
        ])
        const entries = raced ?? this.#sourceEntriesCache.get(srcKey) ?? []
        if (!raced) {
          const usedKey = tileSourceProjectionKey(entries)
          void live.then((res) => {
            const gotKey = tileSourceProjectionKey(res)
            if (gotKey !== usedKey) this.requestRender()
          }).catch(() => { /* already logged by the registry */ })
        }

        // ── PARTICIPANT STACKS ───────────────────────────────────────
        // Every peer entry, INCLUDING the names you already hold. A
        // peer publishing `notes` where you have `notes` is not a
        // second tile — same coordinates means same tile
        // (documentation/superimposition.md) — so it collapses onto
        // yours as a variant underneath instead of being dropped.
        //
        // Order is the participant order the swarm resolved (freshest
        // publisher first, matching the layer-cycle strip), with YOU at
        // index 0 wherever you hold the label: rolling always starts
        // from your own version and comes back to it.
        const stacks = new Map<string, StackVariant[]>()
        for (const e of entries) {
          if (e.kind !== 'peer') continue
          const pk = e.source?.peerPubkey
          if (typeof pk !== 'string' || pk.length === 0) continue
          let bag = stacks.get(e.name)
          if (!bag) {
            bag = localCellSet.has(e.name) ? [{ pubkey: '' }] : []
            stacks.set(e.name, bag)
          }
          // One variant per participant. A peer republishing within a
          // pass must not deepen their own stack entry.
          if (bag.some(v => v.pubkey === pk)) continue
          const vsig = e.source?.imageSig
          const vidx = e.source?.peerIndex
          const properties = e.source?.properties
          const titles = e.source?.titles
          const layerSig = e.source?.layerSig
          bag.push({
            pubkey: pk,
            ...(typeof vsig === 'string' && /^[a-f0-9]{64}$/i.test(vsig) ? { imageSig: vsig.toLowerCase() } : {}),
            ...(typeof vidx === 'number' && Number.isFinite(vidx) && vidx >= 0 ? { index: vidx } : {}),
            ...(properties ? { properties } : {}),
            ...(titles ? { titles } : {}),
            ...(typeof layerSig === 'string' && /^[a-f0-9]{64}$/i.test(layerSig) ? { layerSig: layerSig.toLowerCase() } : {}),
          })
        }
        setTileStacks(stacks)
        this.#stackDepthByLabel = new Map(
          [...stacks].map(([label, variants]) => [label, variants.length]),
        )

        // Surfacing a participant's layer swaps YOUR version of every
        // shared tile for THEIRS — their picture, at their slot index.
        // Only tiles they actually publish move; the rest of your layer
        // stays put, which is what makes the difference between the two
        // layers readable rather than a full-page swap.
        this.#stackVariantLabels = new Set<string>()
        const spotlit = this.#spotlightPubkey
        if (spotlit) {
          for (const [label, variants] of stacks) {
            if (!localCellSet.has(label)) continue
            const mine = variants.find(v => v.pubkey === spotlit)
            if (!mine) continue
            this.#stackVariantLabels.add(label)
            this.#peerPubkeyByLabel.set(label, spotlit)
            this.registryImageByLabel.delete(label)
            if (mine.imageSig) this.registryImageByLabel.set(label, mine.imageSig)
            if (mine.properties) this.registryPropertiesByLabel.set(label, mine.properties)
            if (mine.titles) this.registryTitlesByLabel.set(label, mine.titles)
            // The SLOT stays yours. A shared tile keeps your index while
            // you roll through its versions — the stack is a depth at
            // one position, and taking the publisher's index instead
            // would slide the tile out from under the pointer that is
            // rolling it. Only tiles that are theirs ALONE take a
            // published index (the peerIndices path below); those have
            // no slot of yours to keep.
          }
        }

        // A label LEAVING the variant set is changing lineage source —
        // theirs → yours on dismiss, theirs → nothing when the publisher
        // departs or is filtered away (transitions with no spotlight
        // event, which is why this diff lives HERE, at the one recompute
        // every path funnels through). Every label-keyed property cache is a
        // derivation of whichever participant last painted—not just image. A
        // surviving entry would manufacture a hybrid from the outgoing
        // lineage's border/tags/link/etc. and the incoming tile. Drop the
        // entire projection; this pass re-derives external state from the
        // selected publisher and local state from layer-first properties.
        for (const label of previousVariantLabels) {
          if (this.#stackVariantLabels.has(label)) continue
          this.#faces.invalidate(label)
        }

        // Mismatch check — only mismatched peer names produce any
        // peer-aware state. If every peer name already exists in
        // localCellSet, the contributor pipeline has nothing new to
        // surface and we render purely from local-derived state.
        // This makes the intent visible in code ("only my tiles when
        // peers add nothing new") instead of relying on the per-entry
        // dedup to silently no-op below.
        const mismatched = entries.filter(e =>
          e.kind === 'peer' && !localCellSet.has(e.name),
        )

        for (const e of mismatched) {
          ephemeralCellSet.add(e.name)
          // Track peer-kind separately so #buildCellCountPayload can mark
          // them as branches, making clicks route through #navigateInto
          // instead of falling through to the 'open' editor action.
          if (e.kind === 'peer') {
            peerCellSet.add(e.name)
            const pidx = e.source?.peerIndex
            // First-publisher-wins — if a second peer publishes the same
            // name with a different index, the first one we encountered
            // anchors the slot. The collision check in TileOrder.pinned
            // catches any pathological overlap with local indices.
            if (typeof pidx === 'number' && Number.isFinite(pidx) && pidx >= 0 && !peerIndices.has(e.name)) {
              peerIndices.set(e.name, pidx)
            }
            // Remember which peer contributed this tile so the spotlight
            // render hook can match cells to the active layer.
            const ppk = (e.source as { peerPubkey?: string } | undefined)?.peerPubkey
            if (typeof ppk === 'string' && ppk.length > 0 && !this.#peerPubkeyByLabel.has(e.name)) {
              this.#peerPubkeyByLabel.set(e.name, ppk)
            }
            // Keep every visual field from the SAME first/freshest publisher
            // that owns the solo tile. A participant variant may differ in
            // border, tags, link, hideText, title, or any other admitted
            // property — choosing its image while reading the rest locally
            // would manufacture a hybrid nobody actually published.
            const firstVariant = !registryVariantSeen.has(e.name)
            if (firstVariant) {
              registryVariantSeen.add(e.name)
              this.registryImageByLabel.delete(e.name)
              if (e.source?.properties) this.registryPropertiesByLabel.set(e.name, e.source.properties)
              if (e.source?.titles) this.registryTitlesByLabel.set(e.name, e.source.titles)
            }
            // The registry entry's publisher image (canonical 0000's
            // small.image, carried by config/snapshot sources). This is
            // the SOLO image path: with no swarm running, loadOne's
            // peerTilesAtCurrentSig lookup is empty, and without this
            // map config-mounted tiles render imageless forever.
            const isig = (e.source as { imageSig?: string } | undefined)?.imageSig
            if (firstVariant && typeof isig === 'string' && /^[a-f0-9]{64}$/i.test(isig)) {
              // The first/freshest publisher's CURRENT sig is authoritative
              // for the complete selected variant. A later participant never
              // contributes only their image to that first variant's props.
              // The per-pass prune below removes the entry when the publisher
              // leaves, so a stale sig can never be used as a fallback to
              // DOWNGRADE an already-shown image.
              this.registryImageByLabel.set(e.name, isig.toLowerCase())
            }
          }
          union.add(e.name)
        }
      }
    } catch (err) {
      // Registry hiccups must never block the render. Previews just
      // won't appear this pass and will catch up on the next render.
      console.warn('[show-cell] ephemeral source resolution failed', err)
    }
    // The atlas is keyed by the stable raw identity, so changing only the
    // selected participant's title would otherwise serve the old glyphs from
    // that key. Invalidate exactly the identities whose reading changed.
    const titleLabels = new Set([...previousVariantTitles.keys(), ...this.registryTitlesByLabel.keys()])
    for (const label of titleLabels) {
      if (JSON.stringify(previousVariantTitles.get(label) ?? {}) !== JSON.stringify(this.registryTitlesByLabel.get(label) ?? {})) {
        this.atlas?.invalidateLabel(label)
      }
    }
    this.#ephemeralCellSet = ephemeralCellSet
    this.#peerCellSet = peerCellSet
    // Drop pubkey entries for labels that fell out of the peer set
    // (peer went stale, navigated away). Keeps the map tight; new peer
    // contributions repopulate it in the loop above.
    // Stack-variant labels are spared: they are YOUR tiles showing a
    // spotlit participant's version, so they were never in peerCellSet
    // (which is peer-ONLY names) and pruning them would strip the
    // publisher's hue and image off the tile the same pass that put
    // them there.
    for (const label of [...this.#peerPubkeyByLabel.keys()]) {
      if (!peerCellSet.has(label) && !this.#stackVariantLabels.has(label)) this.#peerPubkeyByLabel.delete(label)
    }
    // Same prune for the registry image map — it is written ONLY inside the
    // peer block above, so peerCellSet is its membership set. Dropping a
    // departed publisher's sig stops loadOne's fallback (peerImageSigByLabel ??
    // registryImageByLabel) from re-pinning an external tile to a stale/older
    // image after the live publisher leaves; with no fallback, loadOne keeps
    // the already-derived image (fill-if-empty, existing image untouched).
    for (const label of [...this.registryImageByLabel.keys()]) {
      if (!peerCellSet.has(label) && !this.#stackVariantLabels.has(label)) this.registryImageByLabel.delete(label)
    }

    // Reconcile pendingRemoves against the layer's children list. Under
    // layer-as-primitive, the LAYER decides membership: a /remove drops
    // the cell from layer.children but leaves OPFS bytes intact (so
    // undo can restore by deleting the head history row). The check is:
    //   - in layer.children ⇒ pendingRemove is stale (undo restored it,
    //     paste landed, etc.) → drop the entry, let cell render
    //   - not in layer.children ⇒ honor the remove
    // When no layer is available (fresh lineage), fall back to OPFS-truth
    // — the same semantics this code shipped with.
    const reconciled: string[] = []
    for (const cell of this.#pendingRemoves) {
      const presentInTruth = layerAllowed
        ? layerAllowed.has(cell)
        : localCellSet.has(cell)
      if (presentInTruth) {
        reconciled.push(cell)
      } else if (peerCellSet.has(cell) || ephemeralCellSet.has(cell)) {
        // SWARM VIEW INVARIANT: everyone sees what peers are sharing. A
        // locally-deleted name that a LIVE peer still publishes must keep
        // rendering — as their peer/preview tile (localCellSet no longer
        // claims it, so it takes the external dress). The pendingRemove
        // entry stays so local truth remains deleted; only the union
        // suppression is skipped while an external source contributes it.
      } else {
        union.delete(cell)
      }
    }
    for (const cell of reconciled) this.#pendingRemoves.delete(cell)

    // The durable head can legitimately lag an optimistic add by a commit
    // turn. A concurrent full render must project that pending membership too,
    // or it briefly erases the just-added tile and remounts it when the marker
    // lands. The lifecycle clears this set on settle/failure; until then the
    // event is the freshest membership truth the participant has.
    for (const cell of this.#pendingCellMutations) {
      union.add(cell)
      localCellSet.add(cell)
    }

    // filter out blocked external tiles and hidden local tiles before ordering
    const blockedSet = new Set<string>(JSON.parse(localStorage.getItem(`hc:blocked-tiles:${locationKey}`) ?? '[]'))
    for (const blocked of blockedSet) {
      if (!localCellSet.has(blocked)) union.delete(blocked)
    }

    // Global blocklist: the BARE `hc:hidden-tiles` key (no location
    // suffix) holds tile NAMES blocked at every location. Set by hand:
    //   localStorage.setItem('hc:hidden-tiles', JSON.stringify(['name']))
    // Unconditional — not subject to the show-hidden toggle — and
    // covers own, ephemeral, and peer tiles alike. Parse is guarded
    // because this key is hand-edited; a malformed value means an
    // empty list, never a broken render pass.
    let globalBlocked: string[] = []
    try { globalBlocked = JSON.parse(localStorage.getItem('hc:hidden-tiles') ?? '[]') } catch { /* hand-edited key — ignore malformed value */ }
    for (const blocked of globalBlocked) {
      union.delete(blocked)
      ephemeralCellSet.delete(blocked)
      peerCellSet.delete(blocked)
    }

    // Layer no longer carries a `hidden` array — visibility is a
    // bee-owned primitive. Read live localStorage in both rewound and
    // head positions. (Per-position playback of visibility is the
    // visibility bee's responsibility, not the renderer's.)
    //
    // Block list also covers swarm peer tiles: a hidden name should
    // disappear regardless of whether the user owns it or it arrived
    // from a peer publish. Without the unconditional delete a user
    // who hides a peer tile would see it pop back on every swarm
    // republish. ephemeralCellSet/peerCellSet stay in sync so the
    // tile-overlay doesn't keep treating it as a dashed preview.
    // Hide list lives in THREE places that union into the renderer's
    // filter:
    //   1. Zone-scoped localStorage: `hc:hidden-tiles:<loc>:z<zone>`
    //      where zone is base64url(room\0secret), written/cleared by
    //      SwarmDrone#updateZoneKey on every credential change. Per-
    //      session/per-zone scope: switching zone gives a fresh empty
    //      filter at the new zone.
    //   2. Bare-key localStorage: `hc:hidden-tiles:<loc>` — the legacy
    //      pre-zone-scoping key. Always read alongside (1) so any hide
    //      that was ever written under either key survives. Bleed
    //      protection still holds at the WRITE side because new
    //      writes only go to the zone-scoped key while public.
    //   3. SwarmDrone.hiddenAtCurrentSig() — peer-published kind 30202
    //      events at the current composed sig. Restores filter on
    //      refresh via relay echo with no client storage.
    // Any source hiding a name drops it from the render.
    // SESSION-ONLY hides — read from the in-memory store (see session-hide.store.ts).
    // A refresh empties it, so a hide never persists across reloads.
    const localHidden: string[] = JSON.parse(sessionHideStore.getItem(hideStorageKey(locationKey)) ?? '[]')
    const bareHidden: string[] = JSON.parse(sessionHideStore.getItem(`hc:hidden-tiles:${locationKey}`) ?? '[]')
    const hiddenSet = new Set<string>([...localHidden, ...bareHidden])
    try {
      const swarm = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') as
        | { hiddenAtCurrentSig?: () => ReadonlySet<string> }
        | undefined
      const swarmHidden = swarm?.hiddenAtCurrentSig?.() ?? new Set<string>()
      for (const n of swarmHidden) hiddenSet.add(n)
    } catch { /* swarm not registered yet — local hides still apply */ }

    // Zone-INDEPENDENT hide list (hc:hidden-lineages, path-keyed). Every
    // source above is keyed by the CURRENT zone / composed sig, which
    // CHANGES the instant you join a swarm (room+secret enter the sig):
    // hideStorageKey() flips to the new zone suffix and hiddenAtCurrentSig()
    // reads the new sig — both empty at that moment. Nothing then re-asserts
    // the hide until the 30s heartbeat republishes the kind-30202 event and
    // its relay echo lands, so a tile you hid visibly reappears for ~30s
    // after joining. This path-keyed list survives every zone transition
    // (it's the SAME "skip these forever" list the swarm tile source already
    // applies to PEER visuals — SwarmDrone.readHiddenLineages), so reading it
    // here makes the own-tile hide hold INSTANTLY on join. Name/path
    // convention matches the peer path exactly: `<locKey>/<name>` (bare
    // `<name>` at root). Session-only (sessionHideStore), same as the keys
    // above, so a reload still clears it — unchanged behaviour there.
    try {
      const rawLineages = sessionHideStore.getItem('hc:hidden-lineages')
      const lineageArr = rawLineages ? JSON.parse(rawLineages) : []
      if (Array.isArray(lineageArr) && lineageArr.length > 0) {
        const lineageSet = new Set<string>(lineageArr as string[])
        const locKey = passSegments.join('/')
        for (const name of union) {
          const path = locKey ? `${locKey}/${name}` : name
          if (lineageSet.has(path)) hiddenSet.add(name)
        }
      }
    } catch { /* malformed hc:hidden-lineages — other hide sources still apply */ }

    // TILES ARE ASSETS for takeover views (visual-bee `replacesTileRender`):
    // a cell claimed by such a view — the post-it whose sticky, not hexagon,
    // is its whole presence — leaves the hex render entirely.
    //
    // UNCONDITIONAL, unlike a hide: the claim and the hexagon are MUTUALLY
    // EXCLUSIVE, so this filter is not subject to the show-hidden toggle.
    // (It was, on the theory that show-hidden doubles as an X-ray onto the
    // underlying tile. In practice that just put the tile and its sticky on
    // screen together — the one thing the flag exists to prevent — and the
    // participant has no way to tell an X-ray from a bug. The tile is still
    // reachable: `/postit tile` stands the view down and the hexagon is
    // back.) Registry-driven: no view is named here.
    try {
      const beeRegistry = (window as any).ioc?.get?.('@diamondcoreprocessor.com/VisualBeeRegistry') as
        | { kindsReplacingTileRender?: () => ReadonlySet<string> }
        | undefined
      const takeoverKinds = beeRegistry?.kindsReplacingTileRender?.()
      if (takeoverKinds && takeoverKinds.size > 0) {
        for (const name of [...union]) {
          const claiming = kindsForLabel(name).filter(k => takeoverKinds.has(k))
          if (!claiming.length) continue
          // A takeover the participant switched OFF on the roster (or that a
          // publisher withheld) is DORMANT — its view renders nothing, so the
          // hexagon is the cell's presence again. Without this the claim held
          // regardless and the cell vanished entirely when the behavior was
          // turned off: no sticky, no tile, no way back.
          if (claiming.every(k => isBehaviorDormant(k, [...passSegments, name]))) continue
          union.delete(name)
          ephemeralCellSet.delete(name)
          peerCellSet.delete(name)
        }
      }
    } catch { /* registry not up yet — tiles render this pass; the next synchronize re-filters */ }

    this.#currentHiddenSet = hiddenSet
    if (!this.#showHiddenItems) {
      for (const hidden of hiddenSet) {
        union.delete(hidden)
        ephemeralCellSet.delete(hidden)
        peerCellSet.delete(hidden)
      }
    }

    // A SWITCHED-OFF launcher member (a game whose Beehaviors light is out) is
    // a HIDDEN tile, never a missing one: its group keeps it as a member, so
    // the page's layer keeps its cell, and this pass paints it grey with the
    // overlay's unhide as the way back. Not subject to the show-hidden eye — a
    // behaviour going dark must be OBVIOUS on the page that offers it.
    const dormantLaunch = new Set<string>()
    if (isLauncherLocation(passSegments)) {
      try {
        const reg = (window as any).ioc?.get?.('@hypercomb.social/GroupLauncher') as
          | { get?: (id: string) => { members?: () => readonly { label?: string; dormant?: boolean }[] } | undefined }
          | undefined
        for (const m of reg?.get?.(String(passSegments[0]))?.members?.() ?? []) {
          if (m?.dormant === true && m.label && union.has(m.label)) dormantLaunch.add(m.label)
        }
      } catch { /* registry not up yet — the next synchronize re-reads it */ }
    }
    this.#dormantLaunchLabels = dormantLaunch

    // SWARM PRIVACY — inside a swarm your canvas shows ONLY what you chose to
    // share. World mode (the PREP stage) previews the split by DIMMING the
    // unshared tiles; the moment you actually join, the preview is over and
    // the unshared tiles leave the view entirely, so what you look at is what
    // the swarm looks at ("you wouldn't see your nonshared tiles in a swarm").
    // Joining exits world mode (mesh-header drops to STAGE_PRIVATE on any
    // meshPublic change), so the dim never doubles up with this filter.
    //
    // Gate = exactly the condition under which our tiles actually leave the
    // device: master switch on AND room+secret set (the same gate
    // publishLocalCells and SwarmDrone publish under). Leaving the swarm
    // flips it back and `mesh:public-changed` repaints, so private tiles
    // return at once — nothing is deleted, only filtered out of this pass.
    //
    // OWN tiles only. A peer/ephemeral contribution is somebody else's
    // sharing decision, already vetted by THEIR isCellPublic before it left
    // their device; running our flag over it would blank the swarm. A name
    // that is both ours and peer-published stays for the same reason.
    if (this.#publicMode && this.#mesh.credentialed) {
      const shareLocation = String(this.resolve<any>('lineage')?.explorerLabel?.() ?? '/')
      for (const name of union) {
        if (!localCellSet.has(name)) continue
        if (peerCellSet.has(name) || ephemeralCellSet.has(name)) continue
        if (!isCellPublic(shareLocation, name)) union.delete(name)
      }
    }

    // TILES ARE UNIVERSAL (Jaime, 2026-07-28). Content renders identically on
    // every platform — no `mobile:friendly` requirement, no mobile filtering
    // of the union. The retired viewer gate deleted every unmarked name here,
    // which blanked unmarked hives on phones and silently swallowed freshly
    // created tiles the moment mobile mode was active. Platform capability is
    // expressed on BEHAVIORS (registry pheromones — a view/bee declares
    // mobile, or mobile+desktop), never on content.

    // ── SWARM PARTICIPANT FILTER (belt-and-braces) ──────────
    // The authoritative filter runs at the SOURCE (swarm.drone
    // #registerTileSource, before the registry's kind:name dedup — which is
    // what keeps a same-name tile resolvable to a SELECTED publisher). This
    // pass only catches entries served from a stale #sourceEntriesCache in
    // the same frame a toggle lands. Peers only: a name that is also the
    // participant's own tile is never filtered.
    if (this.#participantFilter.size > 0) {
      for (const name of [...peerCellSet]) {
        if (localCellSet.has(name)) continue
        const contributor = this.#peerPubkeyByLabel.get(name)
        if (contributor && this.#participantFilter.has(contributor)) continue
        union.delete(name)
        ephemeralCellSet.delete(name)
        peerCellSet.delete(name)
      }
    }

    // Reference composition is deliberately not a second preview renderer.
    // Add the draft to this pass as a local-looking cell so it receives the
    // same geometry, label band, image, scale and hit footprint as every
    // ordinary tile. It is only in memory; layer membership is untouched
    // until the References window saves.
    const referenceDraft = this.#referenceDraft
    const draftIsHere = !!referenceDraft
      && referenceDraft.parentSegments.length === passSegments.length
      && referenceDraft.parentSegments.every((segment, index) => String(segment) === String(passSegments[index]))
    if (referenceDraft && draftIsHere && referenceDraft.name) {
      union.add(referenceDraft.name)
      localCellSet.add(referenceDraft.name)
      if (referenceDraft.imageSig) this.#faces.images.set(referenceDraft.name, referenceDraft.imageSig)
    }

    // Source breakdown for this pass — proves WHERE each tile comes from
    // (layer vs registry vs mesh) so a stray tile (e.g. a phantom "group" in
    // the top layer) can be attributed to the exact non-layer source that
    // injected it. window.__hcSourceReport() summarises it; `outside` lists
    // every rendered name NOT owned by the layer, tagged by source.
    const outside: string[] = []
    for (const name of union) {
      if (localCellSet.has(name)) continue
      const src = peerCellSet.has(name) ? 'peer'
        : ephemeralCellSet.has(name) ? 'ephemeral'
        : this.#mesh.cells.includes(name) ? 'mesh'
        : 'unknown'
      outside.push(`${src}:${name}`)
    }
    this.#recordSourceAudit(locationKey, {
      staleContent: srcStaleLen,
      freshHead: srcFreshLen,
      layerLocal: localCellSet.size,
      ephemeral: ephemeralCellSet.size,
      peer: peerCellSet.size,
      mesh: this.#mesh.cells.length,
      union: union.size,
      outside,
    })

    // read layout mode for this location
    this.#layoutMode = this.#order.layoutMode(locationKey)

    // resolve cell ordering through the layout mode strategy. `dir`
    // may be null when no OPFS folder mirror exists for this sub-layer;
    // pass a typed sentinel so the resolver chooses its layer-only
    // strategy instead of guarding on null shape inside the resolver.
    // navPass tells the resolver this is a layer CHANGE, so unindexed
    // placement must be deterministic (the on-screen camera still belongs
    // to the outgoing page — scoring against it is the "tiles land where
    // they'd be best on the page I just left" scramble). Evaluated BEFORE
    // the await: render bodies are serialized by requestRender, so
    // renderedLocationKey is stable across this pass.
    const navPass = locationKey !== this.renderedLocationKey
    const orderStats = { coldIndexNames: [] as string[] }
    const cellNames = await this.#order.order(this.#layoutMode, dir as FileSystemDirectoryHandle, union, localCellSet, lineage, peerIndices, passSegments, navPass, orderStats)

    // ── INDEX COMPLETENESS GATE ──────────────────────────────────────
    // The name gate above guarantees every child NAME resolved; this one
    // guarantees every child's INDEX read was authoritative. A cold index
    // (layer head not warmed / bytes not pooled yet) means a tile that
    // OWNS a durable slot would be score-filled into a wrong one — the
    // "tiles randomly rearranged on navigation" glitch. Hold the paint
    // (outgoing layer stays up — nothing has been hidden or superseded
    // yet), retry with backoff, and paint best-effort once the bounded
    // budget is spent so a permanently-cold tile can't blank the canvas.
    // The nurse never caches cold reads, so each retry re-reads the head.
    if (orderStats.coldIndexNames.length > 0) {
      const idxGateKey = 'idx:' + (gateParentSig || locationKey)
      const idxHeldFor = this.#gateHoldAge('idx:' + locationKey)
      if (!this.#resolveGateExhausted.has(idxGateKey)) {
        const attempts = (this.#incompleteResolveAttempts.get(idxGateKey) ?? 0) + 1
        this.#incompleteResolveAttempts.set(idxGateKey, attempts)
        if (attempts <= ShowCellDrone.#RESOLVE_GATE_MAX_ATTEMPTS && idxHeldFor <= ShowCellDrone.#RESOLVE_GATE_HOLD_MS) {
          this.#recordRenderAudit('gate', union.size, locationKey)
          console.info(`[diag:idxres] GATE hold loc=${locationKey} attempt=${attempts}/${ShowCellDrone.#RESOLVE_GATE_MAX_ATTEMPTS} cold-index: ${orderStats.coldIndexNames.join(', ')} — deferring paint`)
          this.#forceNextRender = true
          setTimeout(() => this.requestRender(), Math.min(400, 60 * attempts))
          return
        }
        this.#resolveGateExhausted.add(idxGateKey)
        console.warn(`[diag:idxres] GATE exhausted loc=${locationKey} after ${attempts} attempts cold-index: ${orderStats.coldIndexNames.join(', ')} — painting best-effort`)
      }
    } else {
      this.#incompleteResolveAttempts.delete('idx:' + (gateParentSig || locationKey))
      this.#gateFirstHoldAt.delete('idx:' + locationKey)
    }

    const previousLocationKey = this.renderedLocationKey
    const layerChanged = locationKey !== previousLocationKey

    // note: if streaming is active for the same layer, let the stream finish
    if (this.streamActive && !layerChanged) return

    // note: layer changed — supersede any active stream, rebuild
    if (layerChanged) {
      // Capture the OUTGOING layer's live VP state into our cache so
      // a future return to that layer restores where the user actually
      // left it (pan/zoom/meshOffset they applied this session). VP's
      // OPFS write is debounced; the in-memory cache stays stale until
      // we explicitly sync it. Without this sync the user reports
      // "drag is lost when I nav back, only refresh shows it."
      this.#syncCacheFromVP(this.renderedLocationKey)
      // Bump the stream token FIRST, before any await. Any batch still
      // running inside the old stream will check this on its next
      // iteration boundary and bail out.
      const myToken = ++this.#streamToken
      this.renderedLocationKey = locationKey
      this.renderedCellsKey = ''
      this.renderedCells.clear()
      this.#pendingRemoves.clear()
      this.#slots.clear()  // layer change invalidates the slot state machine

      // Hide the OUTGOING layer BEFORE the new location's viewport is
      // applied. The first-visit path awaits an OPFS read below, and the
      // new viewport (zoom/pan/meshOffset) lands on the container while
      // the await is in flight — with the old tiles still visible, the
      // user saw the CURRENT level visibly re-zoom/jump before the next
      // level's children streamed in. Hiding first makes the transition
      // clean: old level out, then viewport, then children stream in.
      if (this.layer) this.layer.visible = false

      // Viewport: prefer the in-memory snapshot (sync). MUST await the
      // OPFS read on first visit — backgrounding it caused mesh to render
      // at the previous layer's pan/zoom, then snap to the saved viewport
      // when the read landed. User saw "drift to the right/left after
      // refresh" especially on deep-link boot where the very first render
      // is the slow path.
      const vpSnap = this.#layerViewportCache.get(locationKey)
      let appliedSnap: ViewportSnapshot | null = null
      if (vpSnap) {
        // appliedSnap must be what was ACTUALLY applied — the sanitizer
        // may have rejected components of the cached snapshot.
        appliedSnap = this.#applyViewportFromSnapshot(vpSnap)
      } else {
        // Viewport is sig-keyed by lineage segments (no OPFS dir
        // required) — always read so dir-less sub-layers restore too.
        appliedSnap = await this.#applyViewportForLayerReadSnapshot(
          dir,
          lineage.explorerSegments?.() ?? [],
        )
      }

      // Set pendingRecenter EXPLICITLY based on the new layer's saved
      // state — never inherit from a previous render. A previous layer
      // that bailed via clearMesh (e.g. empty branch) used to leak
      // pendingRecenter=true, which then ignored the new layer's saved
      // meshOffset and recentered instead — tiles + overlay misaligned
      // for everything except the layer that just ran a clean recenter.
      this.#pendingRecenter = !appliedSnap?.meshOffset
      if (this.#pendingRecenter && this.hexMesh) {
        // No saved offset → reset mesh to (0,0) and emit so the
        // overlay's click->axial math uses the right offset between
        // now and the recenter applyGeometry will run momentarily.
        this.hexMesh.position.set(0, 0)
        this.emitEffect('render:mesh-offset', { x: 0, y: 0 })
      }

      // First visit to adopted content → fit-to-content once, persisted so it
      // sticks (see #pendingFirstVisitFit). isWithinAdoptedRoot covers the
      // adopted root AND every page beneath it; hasPersistedViewportAt is false
      // ONLY on a genuine first visit (no local __viewport__ entry yet — the
      // fit writes one, so this never re-fires). The fit itself is run by
      // applyGeometry, before the reveal below.
      const fvSegments = lineage.explorerSegments?.() ?? []
      this.#pendingFirstVisitFit =
        isWithinAdoptedRoot(fvSegments) && !(await hasPersistedViewportAt(fvSegments))

      // If the stream token bumped while we were awaiting the viewport
      // read, abandon — newer renderFromSynchronize is now the source
      // of truth for this layer's render.
      if (myToken !== this.#streamToken) return

      // Tell VP which location it's reporting to so subsequent pan/zoom
      // writes persist to the correct layer. Viewport is keyed by lineage
      // segments in the sig-keyed __viewport__ store — no OPFS dir needed,
      // so this works for dir-less sub-layers and for root alike.
      const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
      vp?.setCurrentLocation?.(lineage.explorerSegments?.() ?? [])

      if (cellNames.length === 0) {
        if (this.layer) this.layer.visible = true
        // Ready + genuinely empty (this is the boot path for an empty root):
        // settled=true so the loading splash reveals the hive instead of
        // waiting for a count>0 that will never arrive.
        this.clearMesh("layer-change: location has no cells", true)
        return
      }

      // ── EAGER CACHE ─────────────────────────────────────────────
      // Build cells now and populate the back-nav cache BEFORE
      // streamCells kicks off. If user navigates away and back fast
      // (or this stream gets superseded), the back-nav fast path will
      // still find populated caches and restore in <1ms instead of
      // dropping to the full slow path again. Image sigs may be
      // missing on this initial cache write — streamCells fills them
      // in as it loads — but the cells are correct and the back-nav
      // fast path's own loop will pick up imageSigs from the
      // per-label cellImageCache as they land.
      const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
      const maxCells = Math.min(cellNames.length, axialMax)
      const eagerCells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
      if (eagerCells.length > 0) {
        this.#layerCellsCache.set(locationKey, {
          cells: [...eagerCells], cellNames, localCellSet, branchSet,
        })
      }

      // (layer already hidden above, before the viewport apply — it stays
      // hidden until streamCells reveals the first batch)

      // emit navigation guard so click handlers block during transition
      this.emitEffect('navigation:guard-start', { locationKey })

      // stream cells progressively (async, non-blocking). Pass our
      // token + locationKey so the stream works against the snapshot
      // that was authoritative when it started; if a newer stream
      // preempts, we stop touching shared state instead of fighting it.
      // streamCells signature still wants a non-null dir for image loads;
      // when we have none, hand a typed sentinel and let the function's
      // null-tolerant branches no-op the disk lookups.
      void this.streamCells(dir as FileSystemDirectoryHandle, cellNames, localCellSet, axial, branchSet, myToken, locationKey)
      return
    }

    // note: same layer — incremental path (cell collection was fresh, images are cached)
    if (cellNames.length === 0) {
      this.clearMesh("same-layer: cellNames empty", true)   // ready + genuinely empty → splash may reveal
      return
    }

    const wasEmpty = this.renderedCount === 0

    // First real render after the layer was empty — the sanctioned exception to
    // "add/remove leaves the screen still". A newly-navigated empty layer never
    // seeds #slots, so its first tile arrives through this full same-layer render
    // (not the incremental path). Navigating in nulls #pendingRecenter (clearMesh)
    // and the add itself never re-sets it, so without this the new mesh inherits
    // the PREVIOUS layer's stale offset and the first tile lands off-screen
    // ("nothing was created"). Re-arm here so applyGeometry frames the mesh on the
    // new bounds AND the wasEmpty camera block below runs. Reaching this line at
    // all means cellNames is non-empty (the length===0 guard above returned), so
    // wasEmpty here is exactly the empty→first-tile transition; a later empty
    // build (maxCells<=0) just clearMesh-resets it, so no spurious recenter.
    if (wasEmpty) this.#pendingRecenter = true

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const maxCells = Math.min(cellNames.length, axialMax)
    if (maxCells <= 0) {
      this.clearMesh(`same-layer: maxCells=0 (names=${cellNames.length}, axial=${axialMax})`, true)
      return
    }

    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    if (cells.length === 0) {
      this.clearMesh("same-layer: axial yielded 0 cells", true)
      return
    }

    // note: load cell images from 0000 properties → __resources__/
    // Runs even when dir is null — loadCellImages is null-tolerant (dir
    // only feeds tags/link reads) and EXTERNAL (peer) tiles resolve
    // images from streamed sigs + __resources__ without any local dir.
    // Launcher-shape hydration rides along so an `agg-` page re-render
    // paints silhouettes on the first pass (see streamCells).
    await Promise.all([
      this.loadCellImages(cells, dir),
      this.#ensureLaunchShapes(cells),
    ])
    if (isStale()) {
      this.renderQueued = true
      return
    }

    // cache render context for fast move:preview path
    this.cachedCellNames = cellNames
    this.cachedLocalCellSet = localCellSet
    this.cachedBranchSet = branchSet

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    await this.applyGeometry(cells)

    // Reveal after the rebuild. Normally the mesh is already visible and this
    // is a no-op; the case that matters is the clipboard-view EXIT, which
    // hides the mesh up front so the viewport restore doesn't visibly resize
    // the outgoing tiles. The empty/bail branches above return before here —
    // that's fine, there's nothing to show in those, so staying hidden is
    // correct.
    if (this.layer) this.layer.visible = true

    if (wasEmpty && cells.length > 0 && this.pixiApp && this.pixiContainer && this.pixiRenderer) {
      // first tile on empty screen → apply 2× default ONLY when the
      // user has no saved zoom/pan for this layer. A layer with saved
      // NOTE: gated on the local `wasEmpty`, NOT `#pendingRecenter`. The
      // applyGeometry() call above consumes #pendingRecenter (sets it false
      // once the mesh recenter runs), so re-reading it here was always false —
      // the camera default never ran and the first tile on a freshly-navigated
      // empty layer stayed at the previous layer's stale camera (off-screen).
      // `wasEmpty` here is exactly the empty→first-tile transition (the
      // cellNames.length===0 guard above returns before this), and the saved-
      // viewport check below still protects a laid-out layer's own viewport.
      // viewport state (mousewheel zoom, spacebar pan, fit-to-screen)
      // but missing meshOffset used to land here and have its zoom+pan
      // wiped to (2, 0, 0) — destroying the user's last position.
      // Read VP's live state to decide; #applyViewportFromSnapshot has
      // already restored saved zoom/pan to the container/stage if
      // present, so we only need to apply the 2× default when VP has
      // nothing to restore.
      const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
      const hasSavedZoom = !!vp?.lastZoom
      const hasSavedPan = !!vp?.lastPan
      if (!hasSavedZoom && !hasSavedPan) {
        const s = this.pixiRenderer.screen
        this.pixiApp.stage.position.set(s.width * 0.5, s.height * 0.5)
        this.pixiContainer.scale.set(2)
        this.pixiContainer.position.set(0, 0)
        if (vp) {
          vp.setZoom(2, 0, 0)
          vp.setPan(0, 0)
        }
      }
    }

    // cache for instant back-navigation
    this.#layerCellsCache.set(locationKey, { cells: [...cells], cellNames, localCellSet, branchSet })
    // seed the slot state machine — incremental paths read from here after every full render
    this.#slots.seed({ names: cellNames, localCells: localCellSet, branches: branchSet, mode: this.#layoutMode })
  }

  /** Pre-paint launcher-decoration hydration. On a launch-group aggregator
   *  page the silhouette is a per-vertex geometry attribute (aShapeMode) and
   *  the clustered-island layout (help's group/role) keys
   *  the coordinate override, so BOTH must be indexed BEFORE the paint — a
   *  rebuild after the async decoration walk visibly shrinks full-size
   *  picture hexagons into their silhouettes, and a cold group index paints
   *  a clustered page as one plain spiral. Runs even when the hexagon toggle
   *  forces plain hexes: that mode only voids silhouettes, never the island
   *  metadata. The index's per-label memo makes repeat calls synchronous
   *  no-ops. */
  #ensureLaunchShapes = async (cells: readonly Cell[]): Promise<void> => {
    if (cells.length === 0) return
    const segs = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')?.explorerSegments?.() ?? []
    if (!isLauncherLocation(segs)) return
    await ensureDecorationsIndexed(cells.map(c => c.label), segs).catch(() => { /* best effort */ })
  }

  private readonly streamCells = async (
    dir: FileSystemDirectoryHandle,
    cellNames: string[],
    localCellSet: Set<string>,
    axial: any,
    branchSet: Set<string> | undefined,
    myToken: number,
    myLocationKey: string,
  ): Promise<void> => {
    this.streamActive = true
    const hcNav = (window as unknown as { __hcNav?: (l: string, e?: string) => void }).__hcNav

    // Superseded before we even started (a newer renderFromSynchronize ran
    // between our void-dispatch and here). Do nothing.
    const superseded = (): boolean => myToken !== this.#streamToken

    // resolve all cell→axial positions through the single mapping function
    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const maxCells = Math.min(cellNames.length, axialMax)
    const allCells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    hcNav?.('stream:start', `${allCells.length} cells`)

    if (allCells.length === 0) {
      // Names resolved to ZERO renderable cells. In pinned layout the
      // cellNames array is SPARSE — padded with '' gaps to hold slot
      // positions — so an empty location has length > 0 (a row of '')
      // yet builds nothing. The earlier `cellNames.length === 0` guards
      // (e.g. the layer-change empty path) don't catch that, so a
      // navigation into an empty location lands here. When the axial map
      // is ready, this is a genuine empty layer: clearMesh tears down any
      // mesh still attached from the PREVIOUS layer — without it,
      // revealing the layer below would show the prior location's tiles,
      // which IS the leftover-tiles bug on swarm navigation — and its
      // cell-count([]) emit drives the empty-layer invitation watermark.
      // (When axial isn't ready yet we keep the old reveal-and-wait
      // behaviour so a transient unready frame doesn't flash empty.)
      const axialReady = typeof axial?.items?.size === 'number' && axial.items.size > 0
      // axialReady gates settled=true: the map is populated and this location
      // simply has no renderable cells — a real empty layer the splash can
      // reveal. (When axial isn't ready we skip clearMesh entirely, so no
      // premature settled signal escapes.)
      if (axialReady) this.clearMesh('stream: empty location (no renderable cells)', true)
      if (this.layer) this.layer.visible = true
      this.streamActive = false
      this.emitEffect('navigation:guard-end', {})
      return
    }

    // ── SINGLE-PASS RENDER ──────────────────────────────────────────
    // A tile's POSITION is its axial slot — known the instant the cell
    // list is built, with zero dependency on its image. So the ENTIRE
    // layer is laid out in ONE applyGeometry: positions, bounds,
    // recenter and any saved fit all settle once, from the COMPLETE set.
    //
    // This replaces the old geometric-batch stream, which rebuilt the
    // GROWING geometry each round. Because bounds grew per batch, the
    // recenter/fit ran against a partial set and then RE-RAN on the next
    // — tiles visibly painted, then resized and shifted as the rest
    // streamed in (and large layers revealed the first batch early so
    // you saw every step). THAT was the "two stages." One pass kills it.
    //
    // Images are resolved up front too, but LOCAL-only and in parallel:
    // loadCellImages never awaits the network — host misses self-heal
    // off-path via fillFromHost and re-render as eggs land. warmup()
    // preheats every tile-props blob + its image, so this is bounded by
    // warm reads, not I/O. Result: the layer appears exactly once,
    // complete and already in its final position. No resize, no
    // reposition, no progressive reveal.
    //
    // Swarm churn (peers joining/leaving, resources arriving) is NOT
    // staggered here. Each such event clears the render key and fires a
    // fresh render that lands in this same single-pass path. "Constantly
    // changing" just means that one pass runs again — never a partial.
    this.renderedCells.clear()
    for (const cell of allCells) this.renderedCells.set(cell.label, cell)

    // Launcher silhouettes are baked into the geometry (aShapeMode), so on an
    // `agg-` page the shape index must be warm BEFORE the single paint below —
    // otherwise every launcher paints as a full-size picture hexagon and then
    // shrinks into its group silhouette when `launch:indexed` lands. Hydrates
    // in parallel with the image loads; a per-label memo makes revisits free.
    // Superseded exits MUST drop streamActive: the token bump may come from a
    // cache-reset (launcher:reconciled, cursor scrub) with no successor stream
    // to reclaim the flag — left true, the render dedup would drop every
    // follow-up pass for this location and the reset could never repaint.
    await Promise.all([
      this.loadCellImages(allCells, dir),
      this.#ensureLaunchShapes(allCells),
    ])
    if (superseded()) { this.streamActive = false; return }

    await this.applyGeometry(allCells, true)
    if (superseded()) { this.streamActive = false; return }

    if (this.layer) this.layer.visible = true
    hcNav?.('reveal:all-at-once', `${allCells.length} tiles`)

    this.streamActive = false
    hcNav?.('stream:done', `${allCells.length} tiles`)
    this.emitEffect('navigation:guard-end', {})

    // cache for instant back-navigation. Use OUR locationKey — do not
    // read this.renderedLocationKey here; a concurrent stream could
    // have repointed it at a different layer, which would store our
    // cells under the wrong cache key and make subsequent back-nav
    // resurrect them on the wrong layer.
    const bset = branchSet ?? new Set<string>()
    this.#layerCellsCache.set(myLocationKey, { cells: [...allCells], cellNames, localCellSet, branchSet: bset })
    this.#slots.seed({ names: cellNames, localCells: localCellSet, branches: bset, mode: this.#layoutMode })

    this.requestRender()
  }

  // Pull ViewportPersistence's live state (pan/zoom/meshOffset — pending
   // OR last-read) into our in-memory snapshot cache for the given layer
   // BEFORE navigating away. Without this, the cache only ever reflects
   // the values at first visit. User pans → VP saves to OPFS via debounce
   // → user navigates away → comes back → cache hit on stale snapshot →
   // mesh restored to OLD pan instead of where the user dragged it. Real
   // refresh worked because that re-read OPFS; in-session nav didn't.
   #syncCacheFromVP = (locationKey: string): void => {
     if (!locationKey) return
     const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
     if (!vp) return
     const existing = this.#layerViewportCache.get(locationKey) ?? {} as ViewportSnapshot
     const lp = vp.lastPan; if (lp) existing.pan = { dx: lp.dx, dy: lp.dy }
     // Preserve the fit flag — without it, back-navigation cache loses
     // the marker that tells #applyViewportFromSnapshot to refit on the
     // new viewport, and the user's `r` fit silently degrades to a
     // raw (cx, cy) restore that drifts off-center after any resize.
     const lz = vp.lastZoom
     if (lz) existing.zoom = lz.fit
       ? { scale: lz.scale, cx: lz.cx, cy: lz.cy, fit: true }
       : { scale: lz.scale, cx: lz.cx, cy: lz.cy }
     const lm = vp.lastMeshOffset; if (lm) existing.meshOffset = { x: lm.x, y: lm.y }
     this.#layerViewportCache.set(locationKey, existing)
   }

  // Reads the layer's saved viewport and returns the snapshot, so the
  // caller can decide whether to recenter (when there's no saved
  // meshOffset for the layer) or keep the mesh where it was last left.
  //
  // Phase B: read prefers the new tile-properties-backed viewport store
  // (signature-addressed, works for sub-layers without OPFS dirs). Falls
  // back to legacy `<dir>/0000.viewport` only if the new path has nothing
  // yet — preserves any pre-migration data while user gestures populate
  // the new path. Once the legacy fallback proves unused, it can be
  // dropped (Step 5).
  readonly #applyViewportForLayerReadSnapshot = async (
    _dir: FileSystemDirectoryHandle | null,
    segments: readonly string[] | null = null,
  ): Promise<ViewportSnapshot> => {
    // Viewport lives in the sig-keyed `__viewport__` store, addressed by
    // the location's lineage segments — no OPFS dir, no history. Works
    // identically for root and dir-less sub-layers.
    let snap: ViewportSnapshot = {}
    try {
      snap = await readViewportAt(segments ?? [])
    } catch {
      snap = {}
    }

    // Apply first (the sanitizer may reject garbage components), then
    // cache + return what was ACTUALLY applied so revisits and the
    // caller's recenter decision never act on rejected values.
    const applied = this.#applyViewportFromSnapshot(snap)
    const locationKey = this.renderedLocationKey
    if (locationKey) this.#layerViewportCache.set(locationKey, applied)
    return applied
  }

  /** Apply a viewport snapshot (sanitized) and return what was ACTUALLY
   *  applied — rejected components come back undefined so callers (cache,
   *  recenter decision) never act on garbage values. */
  #applyViewportFromSnapshot = (snap: ViewportSnapshot): ViewportSnapshot => {
    const container = this.pixiContainer
    const app = this.pixiApp
    const renderer = this.pixiRenderer
    if (!container || !app || !renderer) return {}

    const s = renderer.screen

    // Reject garbage BEFORE applying. A persisted `__viewport__` entry
    // written by a past broken session (duplicate zoom/pan drones
    // fighting over the container, a crash mid-gesture) can hold
    // non-finite or absurd values; applying one flings the freshly
    // rendered tiles off-screen — "the children rendered and then
    // disappeared". Each component is validated independently; an
    // invalid one falls back to its default framing, loudly. The next
    // user gesture overwrites the bad entry, so this self-heals.
    const bound = 8 * Math.max(s.width, s.height, 1)
    const sane = (v: unknown, b = bound): boolean =>
      typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= b
    let zoom = snap.zoom
    if (zoom && !(sane(zoom.scale, 100) && (zoom.scale as number) > 0.01 && sane(zoom.cx) && sane(zoom.cy))) {
      console.warn('[render] viewport restore: rejecting insane zoom snapshot', zoom)
      zoom = undefined
    }
    let pan = snap.pan
    if (pan && !(sane(pan.dx) && sane(pan.dy))) {
      console.warn('[render] viewport restore: rejecting insane pan snapshot', pan)
      pan = undefined
    }
    let meshOffset = snap.meshOffset
    if (meshOffset && !(sane(meshOffset.x) && sane(meshOffset.y))) {
      console.warn('[render] viewport restore: rejecting insane meshOffset snapshot', meshOffset)
      meshOffset = undefined
    }

    if (zoom) {
      // Apply the saved scale + (cx, cy) as an approximation so the
      // initial paint isn't blank, but flag the snapshot for a refit
      // once mesh bounds are available (handled in applyGeometry).
      // Without this, a fit saved at one viewport size renders shrunk
      // and off-center after reload at a different size.
      container.scale.set(zoom.scale)
      container.position.set(zoom.cx, zoom.cy)
      // Pan-respects-fit: refit ONLY when the saved pan is zero (or
      // absent). A non-zero saved pan means the user explicitly moved
      // away from the fit position; refitting (which calls
      // setPan(0,0)) would clobber their pan on every boot.
      const panIsZero = !pan || (pan.dx === 0 && pan.dy === 0)
      this.#pendingFitRestore = !!zoom.fit && panIsZero
    } else {
      container.scale.set(1)
      container.position.set(0, 0)
      this.#pendingFitRestore = false
    }

    if (pan) {
      app.stage.position.set(s.width * 0.5 + pan.dx, s.height * 0.5 + pan.dy)
    } else {
      app.stage.position.set(s.width * 0.5, s.height * 0.5)
    }

    // Restore the saved mesh offset. If the mesh exists, apply now AND
    // emit render:mesh-offset so listeners (TileOverlayDrone uses this
    // to convert click coords → axial; without the emit clicks miss
    // because the overlay still has the previous layer's offset).
    // Otherwise stash the value so applyGeometry can apply + emit it
    // as soon as the mesh is created (first-time render and
    // post-clearMesh re-create both fall into the latter case).
    if (meshOffset) {
      if (this.hexMesh) {
        this.hexMesh.position.set(meshOffset.x, meshOffset.y)
        this.emitEffect('render:mesh-offset', { x: meshOffset.x, y: meshOffset.y })
        this.#pendingMeshOffsetRestore = null
      } else {
        this.#pendingMeshOffsetRestore = { x: meshOffset.x, y: meshOffset.y }
      }
    } else {
      this.#pendingMeshOffsetRestore = null
    }

    return { zoom, pan, meshOffset }
  }

  private readonly applyGeometry = async (cells: Cell[], final = true): Promise<void> => {
    if (cells.length === 0) {
      this.clearMesh("applyGeometry: called with 0 cells")
      return
    }

    const { circumRadiusPx, gapPx, padPx } = this.#hexGeo

    const nextCellsKey = this.buildCellsKey(cells)
    // Read the generations HERE, alongside the key, and store this same pair
    // on the success path — not the post-bake values. The bake loop below can
    // itself evict (an oversized layer displaces its own earlier labels), and
    // that leaves the cells baked before the eviction holding stale UVs; the
    // entry-time pair is what makes the next pass rebuild instead of calling
    // the buffer converged. See #bakedLabelAtlasGen for why they are not part
    // of the key.
    const nextImageAtlasGen = this.imageAtlas?.evictionGeneration ?? 0
    const nextLabelAtlasGen = this.atlas?.evictionGeneration ?? 0
    if (
      nextCellsKey === this.renderedCellsKey
      && cells.length === this.renderedCount
      && nextImageAtlasGen === this.#bakedImageAtlasGen
      && nextLabelAtlasGen === this.#bakedLabelAtlasGen
    ) {
      return
    }

    // The SDF radius uniform receives circumRadiusPx but is treated as the
    // apothem, so each hex is drawn with its POINTS reaching circumRadiusPx/cos30
    // from centre — further than (√3/2)·circumRadiusPx. Size the quad's bounding
    // box to that true point reach so the sharp tips (top/bottom for point-top,
    // left/right for flat-top) aren't sliced flat by the quad edge. Only the
    // transparent quad grows; hex size, spacing and the shader are untouched.
    const pointReachPx = circumRadiusPx / 0.8660254 // centre-to-point of the drawn hex
    const hexHalfW = this.#flat ? pointReachPx : circumRadiusPx
    const hexHalfH = this.#flat ? circumRadiusPx : pointReachPx
    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    if (!this.atlas || !this.imageAtlas) {
      this.clearMesh("applyGeometry: atlas unavailable")
      return
    }

    const labelTex = this.atlas.getAtlasTexture()
    const cellImageTex = this.imageAtlas.getAtlasTexture()

    // Pin THIS pass's labels BEFORE baking them — the hard rule that a
    // visible tile's text never loses its glyphs to a background readiness
    // bake (whose working set can exceed the atlas at hub layers; the
    // eviction→repaint cycle shows as every tile's text blinking). Pinning
    // must precede the bake loop: with the PREVIOUS layer's pins still
    // active, a big layer would bake into the few unpinned slots and evict
    // its own labels mid-pass, re-arming the loop it exists to prevent.
    // The old layer's labels unpin here and become ordinary evictees.
    // PENDING_CELL_LABEL is displayed in place of any mid-mutation cell's
    // name, so it is part of the on-screen set whenever it is baked at all.
    this.atlas.setPinned([...cells.map(c => c.label), PENDING_CELL_LABEL])

    for (const cell of cells) {
      const label = this.#pendingCellMutations.has(cell.label) && !this.atlas.hasLabel(cell.label)
        ? PENDING_CELL_LABEL
        : cell.label
      this.atlas.getLabelUV(label)
    }

    const geom = this.buildFillQuadGeometry(cells, circumRadiusPx, gapPx, quadHalfW, quadHalfH)

    if (!this.shader) {
      this.shader = new HexSdfTextureShader(labelTex, cellImageTex, quadW, quadH, circumRadiusPx)
      const [ar, ag, ab] = this.#accentColor
      this.shader.setAccentColor(ar, ag, ab)
    } else {
      try {
        this.shader.setLabelAtlas(labelTex)
        this.shader.setCellImageAtlas(cellImageTex)
        this.shader.setQuadSize(quadW, quadH)
        this.shader.setRadiusPx(circumRadiusPx)
      } catch {
        this.rebuildRenderResources(this.pixiRenderer)
        this.renderQueued = true
        return
      }
    }
    this.shader.setFlat(this.#flat)
    this.shader.setPivot(this.#pivot)
    this.#applyBandRows()
    this.shader.setLabelMix(this.#labelsVisible ? 1.0 : 0.0)
    this.shader.setGlyphs(this.#domNames ? 0 : 1)
    this.shader.setImageMix(this.#textOnly ? 0.0 : this.#substrateFadeMix())

    // Per-group launcher visuals — NOT universal, and chosen PER TILE so a mixed
    // launch-group page shows each group's OWN silhouette (games → marching
    // Space Invader) and groups never share a visual type. Websites members
    // carry no shape any more — plain picture hexagons like the rest of the hive.
    // The shape is a per-vertex attribute (aShapeMode) packed in applyGeometry
    // from each cell's `launch:target` decoration `shape`; every normal hive page
    // (no such decoration) stays plain hexagons. Here we only run the motion
    // clock when on a launch-group page — the per-vertex gate (aShapeMode > 1.5)
    // limits the actual march to game tiles, leaving hexagons still. Drift
    // amplitude is a small fraction of the hex radius so a marching invader
    // never costs the participant a click.
    const segs = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')?.explorerSegments?.() ?? []
    const onLauncherPage = isLauncherLocation(segs)
    this.#setDrift(onLauncherPage, circumRadiusPx)

    if (!this.hexMesh) {
      this.hexMesh = new Mesh({ geometry: geom as any, shader: (this.shader as any).shader, texture: Texture.WHITE as any } as any)
      ;(this.hexMesh as any).blendMode = 'pre-multiply'
      this.layer!.addChild(this.hexMesh as any)
      // Mesh-offset restore priority:
      //   1. Saved snapshot from OPFS (#pendingMeshOffsetRestore) —
      //      authoritative, survives reload, NEVER changes unless the
      //      user explicitly recenters.
      //   2. Last-known position from previous clearMesh — only used
      //      when the snapshot has no saved offset (e.g. brand-new
      //      layer that was empty when first visited). Keeps a redo
      //      after "undo to empty" from snapping tiles to (0,0).
      //   3. Recenter (when pendingRecenter is set, runs below).
      if (this.#pendingMeshOffsetRestore && !this.#pendingRecenter) {
        this.hexMesh.position.set(this.#pendingMeshOffsetRestore.x, this.#pendingMeshOffsetRestore.y)
        this.emitEffect('render:mesh-offset', { x: this.#pendingMeshOffsetRestore.x, y: this.#pendingMeshOffsetRestore.y })
      } else if (this.#lastMeshOffset && !this.#pendingRecenter) {
        this.hexMesh.position.set(this.#lastMeshOffset.x, this.#lastMeshOffset.y)
        this.emitEffect('render:mesh-offset', { x: this.#lastMeshOffset.x, y: this.#lastMeshOffset.y })
      }
      this.#pendingMeshOffsetRestore = null
      this.#lastMeshOffset = null
    } else {
      // Mesh already exists. If a snapshot restore is pending (e.g.
      // applyViewportFromSnapshot ran before applyGeometry on a layer
      // change without mesh re-creation), apply it now, before any
      // potential recenter. Without this, the saved offset would be
      // dropped on layer-change-without-mesh-recreate paths.
      if (this.#pendingMeshOffsetRestore && !this.#pendingRecenter) {
        this.hexMesh.position.set(this.#pendingMeshOffsetRestore.x, this.#pendingMeshOffsetRestore.y)
        this.emitEffect('render:mesh-offset', { x: this.#pendingMeshOffsetRestore.x, y: this.#pendingMeshOffsetRestore.y })
        this.#pendingMeshOffsetRestore = null
      }
      if (this.geom) this.geom.destroy(true)
      this.hexMesh.geometry = geom
      this.hexMesh.shader = (this.shader as any).shader
    }
    this.hexMesh.visible = true

    // Recenter mesh on its bounds — but ONLY when pendingRecenter is
    // set, which now happens only for the explicit recenter path
    // (navigation.recenter / fitToScreen command, or first-time render
    // of a layer that has no saved meshOffset). Auto-recentering on
    // every layer change was the source of the "drift after refresh /
    // re-centers on back-nav" feedback: each layer was getting a fresh
    // bounds-based offset every visit, and the user's saved pan/zoom
    // landed on a different reference frame. Now the mesh position is
    // saved with the viewport (snap.meshOffset) and restored on load —
    // it never moves unless the user asks it to.
    //
    // When recenter does run, persist the result so the next visit
    // restores the same offset via #applyViewportFromSnapshot above.
    if (this.hexMesh?.getLocalBounds && this.#pendingRecenter) {
      this.hexMesh.position.set(0, 0)
      const bounds = this.hexMesh.getLocalBounds()
      const newX = -(bounds.x + bounds.width * 0.5)
      const newY = -(bounds.y + bounds.height * 0.5)
      this.hexMesh.position.set(newX, newY)
      this.emitEffect('render:mesh-offset', { x: newX, y: newY })
      // Persist so subsequent navs restore this offset rather than
      // recomputing from current bounds (which would drift if cells
      // change shape — undo/redo, add/remove, etc.).
      const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
      // 'user' — the default 'auto' updates the in-memory mirror only, which
      // made the comment above a lie: back-nav kept the offset (via the cache
      // patched below) while a RELOAD recomputed it from live bounds.
      vp?.setMeshOffset?.(newX, newY, 'user')
      // Also patch the in-memory snapshot cache. Without this update,
      // next back-nav reads the old (empty) cached snap, sees no
      // meshOffset, and recomputes from bounds again — defeating the
      // whole point of saving it.
      const cached = this.#layerViewportCache.get(this.renderedLocationKey)
      if (cached) cached.meshOffset = { x: newX, y: newY }
      else this.#layerViewportCache.set(this.renderedLocationKey, { meshOffset: { x: newX, y: newY } })
      if (final) this.#pendingRecenter = false  // consumed only on final batch
    }

    // Publish the tile count BEFORE the refit below — it is an INPUT to it.
    // zoomToFit's safe-area padding keys off `#cellCount` (a lone tile gets
    // 75px of breathing room, anything larger 5px), and that field is fed
    // only by this effect. Emitted after the refit, every restore-refit sized
    // itself against the PREVIOUS page's count: the same layer re-framed to a
    // different zoom depending on where you arrived from, and the first page
    // after a reload always fitted at padding 5 (count still 0).
    this.emitEffect('render:cell-count', { ...this.#buildCellCountPayload(cells), settled: final })

    // After mesh + recenter have settled on the final batch, refit if
    // the restored snapshot was a fit (snap.zoom.fit). The applied
    // (cx, cy) was an approximation derived from the previous
    // viewport's safe area — refitting against the new viewport keeps
    // content centered and not "shrunk" after a resize-then-reload.
    // Gated on `final` so partial-batch bounds don't produce a fit
    // that's too tight (would zoom in then out as more cells stream).
    if (final && (this.#pendingFitRestore || this.#pendingFirstVisitFit) && this.hexMesh?.getLocalBounds) {
      const firstVisit = this.#pendingFirstVisitFit
      this.#pendingFitRestore = false
      this.#pendingFirstVisitFit = false
      const zoom = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ZoomDrone') as { zoomToFit?: (snap?: boolean, source?: 'user' | 'auto-persist' | 'auto') => void } | undefined
      // First-visit adopted fit persists ('auto-persist') so it sticks like a
      // normal viewport and never re-fits; a restored fit re-frames visually
      // only ('auto') and must never re-commit on every entry.
      //
      // 'auto-persist', NOT 'user': this is a RENDER, not a gesture. As 'user'
      // it announced `viewport:fit`, which the control bar treats as an
      // explicit request and uses to discard the page's hand framing — so a
      // first-visit render could quietly strip a framing the participant set.
      zoom?.zoomToFit?.(true, firstVisit ? 'auto-persist' : 'auto')
    }

    this.geom = geom
    this.renderedCellsKey = nextCellsKey
    // The ONE place these may be written: a fresh buffer whose UVs were just
    // re-baked is the only thing that makes a generation "already applied".
    this.#bakedImageAtlasGen = nextImageAtlasGen
    this.#bakedLabelAtlasGen = nextLabelAtlasGen
    this.renderedCount = cells.length
    this.#recordRenderAudit('paint', cells.length, this.renderedLocationKey)
    // A real paint ends every hold on this location — drop both deadlines so a
    // later genuine incompleteness gets its own full window.
    this.#gateFirstHoldAt.delete(this.renderedLocationKey)
    this.#gateFirstHoldAt.delete('idx:' + this.renderedLocationKey)

    // A paint with every image AND every label resolvable is the convergence
    // point of the eviction-repaint cycle — reset its bound here (eviction
    // events alone can't be relied on for the reset: after the reload pass
    // converges, no further event arrives to run a clean scan).
    //
    // The label half is not optional. #evictRepaintCount is SHARED with
    // #onLabelAtlasEvicted, so an image-only reset defeats the bound on any
    // layer with more labels than the 256-slot label atlas: the paint wraps
    // the label ring, the label listener forces a repaint, this reset clears
    // the counter because the images were fine, and the cycle runs forever —
    // visible as tile text blinking. Witnessed on a 522-child layer.
    const imagesConverged = !!this.imageAtlas && !cells.some(c =>
      c.imageSig && !this.imageAtlas!.hasImage(c.imageSig) && !this.imageAtlas!.hasFailed(c.imageSig))
    const labelsConverged = !this.atlas || !cells.some(c =>
      !this.#hidesName(c.hideText, !!(c.imageSig && this.imageAtlas?.hasImage(c.imageSig)))
      && !this.atlas!.hasLabel(c.label))
    if (imagesConverged && labelsConverged) {
      this.#evictRepaintCount = 0
    }

    // Pin every on-screen image so the ring allocator never reuses their
    // slots — the hard display rule: a tile never renders without its
    // image outside text-only mode. Replacing the set wholesale unpins
    // the previous layer's sigs automatically.
    this.imageAtlas?.setPinned([...cells.flatMap(c => (c.imageSig ? [c.imageSig] : [])), ...this.#tilePreviewSigs()])

    // Geometry replacement can change every aCellIndex while the cursor stays
    // still. Hover is label-owned, so rebind that label to the NEW index map
    // before exposing the completed frame. Relying only on another tile:hover
    // event left the normal one-row image strip under a still-visible action
    // overlay until the pointer exited and re-entered the tile.
    const restoredHoverIndex = this.#hoverRevealLabel
      ? this.#labelToIndex.get(this.#hoverRevealLabel)
      : undefined
    this.#applyBandRows()
    this.shader.setHoveredIndex(restoredHoverIndex ?? -1)
    // A geometry replacement can hand us a NEW shader; the swap verb is a
    // property of the open window, not of this frame, so re-apply it here or
    // the cut rim vanishes the first time anything re-renders under it.
    this.#applySwapMode()
    // A full render rebuilt every attribute from the caches; the edit in
    // progress goes back on top of its tile.
    this.#writeTilePreview()
    this.#narrow.emitRenderTags(cells)
  }

  /** 0 = not swapping · 1 = the click takes the hovered tile · 2 = copies it
   *  · 3 = the hexagon walk (the click enters, landing on the grid).
   *  Pushed by `clipboard:verb` (TileOverlayDrone's cue is the one resolver). */
  #swapMode = 0
  /** The verb's colour, normalised — amber for take, near-white for copy. */
  #swapColor: [number, number, number] = [1, 0.77, 0.5]

  #applySwapMode = (): void => {
    const shader = this.shader
    if (!shader) return
    shader.setSwapMode(this.#swapMode)
    shader.setSwapColor(this.#swapColor[0], this.#swapColor[1], this.#swapColor[2])
  }

  /**
   * Render-pass auditor (proof instrumentation). Records every PAINT and
   * every completeness-GATE hold to `window.__hcRenderAudit`, and exposes
   * `window.__hcAuditReport()` which groups paints by location and flags a
   * two-stage load (a location painted more than once with a GROWING cell
   * count — exactly the "10 then 13" signature). A correct single-pass
   * load shows each location with `paints: 1` and `twoStage: false`.
   */
  /** Age in ms of the current completeness hold on `key`, starting the clock
   *  on the first call. Keyed by LOCATION so a churning parent sig cannot
   *  reset it, and deliberately NOT cleared by `#rearmResolveGates` — only a
   *  clean resolution or an actual paint drops it. */
  #gateHoldAge(key: string): number {
    const now = Date.now()
    const first = this.#gateFirstHoldAt.get(key)
    if (first === undefined) { this.#gateFirstHoldAt.set(key, now); return 0 }
    return now - first
  }

  #recordRenderAudit(kind: 'paint' | 'gate', count: number, loc: string): void {
    try {
      const w = window as unknown as {
        __hcRenderAudit?: { t: number; kind: string; loc: string; count: number }[]
        __hcAuditReport?: () => unknown
      }
      const arr = (w.__hcRenderAudit ??= [])
      arr.push({ t: Math.round(performance.now()), kind, loc, count })
      if (arr.length > 600) arr.splice(0, arr.length - 600)
      if (!w.__hcAuditReport) {
        w.__hcAuditReport = () => {
          const log = w.__hcRenderAudit ?? []
          const byLoc = new Map<string, number[]>()
          const gates = new Map<string, number>()
          for (const r of log) {
            if (r.kind === 'paint') {
              const cur = byLoc.get(r.loc) ?? []
              cur.push(r.count)
              byLoc.set(r.loc, cur)
            } else if (r.kind === 'gate') {
              gates.set(r.loc, (gates.get(r.loc) ?? 0) + 1)
            }
          }
          const rows: { loc: string; paints: number; counts: number[]; gateHolds: number; twoStage: boolean }[] = []
          for (const [loc, counts] of byLoc) {
            const distinct = new Set(counts)
            const twoStage = counts.length > 1 && distinct.size > 1 && counts[counts.length - 1] > counts[0]
            rows.push({ loc, paints: counts.length, counts, gateHolds: gates.get(loc) ?? 0, twoStage })
          }
          const anyTwoStage = rows.some(r => r.twoStage)
          return { ok: !anyTwoStage, anyTwoStage, rows }
        }
      }
    } catch { /* instrumentation must never break a render */ }
  }

  /**
   * Per-pass SOURCE breakdown (proof instrumentation). Records, for each
   * render pass, how many tiles each source contributed: the memoized
   * currentLayer() child count vs the fresh head (`staleContent`/`freshHead`
   * — a divergence is the stale-content two-stage), the layer-local set, and
   * ephemeral/peer/mesh additions. `window.__hcSourceReport()` returns the
   * recent passes so a two-stage count (e.g. 10 then 13) can be attributed to
   * the exact source on real data.
   */
  #recordSourceAudit(loc: string, b: { staleContent: number; freshHead: number; layerLocal: number; ephemeral: number; peer: number; mesh: number; union: number; outside: string[] }): void {
    try {
      const w = window as unknown as {
        __hcSourceAudit?: ({ t: number; loc: string } & typeof b)[]
        __hcSourceReport?: () => unknown
      }
      const arr = (w.__hcSourceAudit ??= [])
      arr.push({ t: Math.round(performance.now()), loc, ...b })
      if (arr.length > 200) arr.splice(0, arr.length - 200)
      if (!w.__hcSourceReport) {
        w.__hcSourceReport = () => {
          const log = w.__hcSourceAudit ?? []
          // Flag passes where the fresh head exceeded the memoized content
          // (stale-content) or where union > layerLocal (tiles from outside
          // the layer — registry peer / ephemeral / mesh).
          return log.map(r => ({
            ...r,
            staleContentLag: r.freshHead > r.staleContent,
            outsideLayer: r.union - r.layerLocal,
          }))
        }
      }
    } catch { /* instrumentation must never break a render */ }
  }

  /** Returns the current imageMix value, accounting for substrate fade-in animation. */
  #substrateFadeMix(): number {
    if (this.#substrateFadeStart === null) return 1.0
    const elapsed = performance.now() - this.#substrateFadeStart
    if (elapsed >= 1000) {
      this.#substrateFadeStart = null
      return 1.0
    }
    const t = elapsed / 1000
    // Phase 1 (0–500ms): quadratic ease-in from 0 → 0.5 (slow build)
    // Phase 2 (500–1000ms): linear ramp from 0.5 → 1.0 (quick finish)
    if (t < 0.5) {
      const p = t / 0.5
      return 0.5 * p * p
    }
    return 0.5 + 0.5 * ((t - 0.5) / 0.5)
  }

  /** Kick off the substrate fade-in animation loop. */
  #startSubstrateFade(): void {
    if (this.#textOnly) return
    this.#substrateFadeStart = performance.now()
    cancelAnimationFrame(this.#substrateFadeRaf)
    const tick = (): void => {
      if (this.#substrateFadeStart === null) return
      const mix = this.#substrateFadeMix()
      this.shader?.setImageMix(mix)
      if (mix < 1.0) {
        this.#substrateFadeRaf = requestAnimationFrame(tick)
      } else {
        this.#substrateFadeStart = null
      }
    }
    this.#substrateFadeRaf = requestAnimationFrame(tick)
  }

  private ensureListeners = (): void => {
    if (this.listening) return
    this.listening = true

    // respond to processor-emitted synchronize and URL navigation
    window.addEventListener('synchronize', this.onSynchronize)
    window.addEventListener('navigate', this.onNavigate)
    // CLICK → TILES, AS ONE NUMBER. Every perf claim about navigation has been
    // argued from reading code; this makes the next one a measurement. One
    // line per navigation, when the first non-empty pass lands.
    window.addEventListener('navigate', this.#onNavigateStarted)

    // Atlas ring eviction — a sig referenced by an ON-SCREEN cell can lose
    // its pixels with no render pass in flight (substrate preheat, detached
    // refills wrapping the ring). The baked UV then samples whatever image
    // took over the slot — the tile shows WRONG pixels — until something
    // else invalidates. Repaint only when a rendered cell is actually
    // affected; mid-pass evictions are skipped because the running pass
    // rebuilds geometry itself.
    window.addEventListener('hex-image-atlas:evicted', this.#onAtlasEvicted)
    window.addEventListener('hex-image-atlas:retry', this.#onAtlasEvicted)
    // Label-atlas twin — in-place updates bake uncached labels on demand,
    // and once the 256-slot label ring has wrapped, such a bake displaces
    // an on-screen label whose baked UV then shows the WRONG text.
    window.addEventListener('hex-label-atlas:evicted', this.#onLabelAtlasEvicted)

    // Lineage 'change' is the canonical "the user's explorerPath
    // changed" signal — fired by every code path that mutates the
    // path (URL-bar navigation, explorerEnter, explorerUp,
    // showDomainRoot, etc.). Without this listener, navigation into
    // sub-layers (e.g., /dolphin) doesn't trigger a fresh render of
    // the new location's tiles; the cursor never auto-loads the new
    // bag and the canvas stays empty until something else (mouse
    // click on a tile, manual refresh, a synchronize event) forces a
    // requestRender. The `navigate` window event covers URL-driven
    // nav but not internal explorerEnter / explorerUp paths, so
    // listening to both gives us full coverage.
    const lineage = this.resolve<EventTarget>('lineage')
    if (lineage) {
      lineage.addEventListener('change', this.onLineageChange)
      this.lineageChangeListening = true
    }

    // ── THE SURFACE COMES BACK ────────────────────────────────────────
    // Leaving a view puts the participant back on the tiles, and THE
    // ARRIVAL GATE'S BARGAIN is that the mesh painted under the covered
    // canvas is sitting there to be revealed with no repaint. That is one
    // assumption too many. A pass abandoned mid-walk, a view that navigated
    // before it closed, a takeover that mounted before this drone ever
    // painted the address — each of them leaves the mesh holding SOMEWHERE
    // ELSE, or holding nothing, and the reveal is an empty ink field.
    //
    // Nothing arrives to fix it, either: closing a view rarely changes the
    // location, so the pass that would repaint meets the unchanged-page
    // fast path at the top of renderFromSynchronize and returns having done
    // nothing. Blank until the participant navigates away and back.
    //
    // So the return is TOLD, not assumed: on the change back to the
    // hexagons, drop a mesh that belongs to another location and FORCE one
    // paint for where the participant actually stands. Same rule the
    // hive-visible restore already uses, and just as cheap — one paint per
    // view close. Read over IoC because ViewMode is a shell service and a
    // module may never import the shell.
    const viewMode = get<EventTarget & { addEventListener?: EventTarget['addEventListener'] }>('@hypercomb.social/ViewMode')
    if (viewMode?.addEventListener) {
      viewMode.addEventListener('change', this.#onViewModeChange)
      this.#viewModeSource = viewMode
    }

    // Initial-load kick. When the page boots at a non-root URL (e.g.
    // /dolphin), the Lineage has already settled to that path before
    // ensureListeners runs, so the 'change' event we just hooked never
    // fires for the boot state. Without this explicit request the
    // sub-layer canvas stays empty until the user does something that
    // causes a render — clicking, panning, navigating away and back.
    // Calling requestRender here is idempotent (the per-pulse render
    // lock collapses repeats), so it's safe to fire alongside the
    // first heartbeat-driven pass.
    this.requestRender()

    // ── QUIET LANDING ── see #quietLanding for the whole bargain: the
    // bridge's write is truth the instant it lands, the repaint is what
    // waits. This side is a plain on/off — the DEPTH count and the settle
    // delay that make a burst of twenty writes into ONE window belong to
    // the producer, which is the only thing that knows a burst is a burst.
    this.onEffect<{ active?: boolean; writes?: number }>('landing:quiet', (payload) => {
      this.#quietLanding = payload?.active === true
      // Carry the producer's tally while the window is OPEN only: the close
      // emit reports zero, and adopting that would wipe a badge that is
      // still owed. Cleared by the paint that shows them, not by the burst
      // ending.
      const writes = Number(payload?.writes ?? 0)
      if (this.#quietLanding && writes > 0) this.#landedWrites = writes
    })

    // The badge was tapped — the participant asked for what landed. The
    // held change is at the SAME location, so without the force the
    // unchanged-page fast path returns having done nothing and the tap
    // does visibly nothing. Guarded on the held count so EffectBus's
    // last-value replay can't fire a stray forced paint at boot.
    this.onEffect('landing:apply', () => {
      if (this.#heldRenders <= 0) return
      this.#quietLanding = false
      this.#forceNextRender = true
      this.requestRender()
    })

    // content:arrived (kind: layer) — LAYER bytes just landed detached from
    // the host/mesh (Store.fetchLayerFromHost, the layer-side self-heal).
    // Any completeness gate that exhausted while those bytes were missing
    // is stale: re-arm the gates and force a paint so the healed children
    // surface now instead of waiting for an unrelated invalidation. Cheap
    // and bounded — arrivals only fire once per healed sig.
    this.onEffect<{ sig: string; kind: string }>('content:arrived', (payload) => {
      if (payload?.kind !== 'layer') return
      this.#rearmResolveGates()
    })

    // render:set-hive-visible — a takeover feature (screensaver bounce mode)
    // hides the hive grid while it owns the screen, then restores it. While
    // hidden, renderFromSynchronize short-circuits (see #hiveHidden) so a
    // stray synchronize can't un-hide the layer mid-takeover. On restore we
    // force a fresh paint since renders were suppressed.
    this.onEffect<{ visible: boolean }>('render:set-hive-visible', ({ visible }) => {
      this.#hiveHidden = !visible
      if (!visible) {
        if (this.layer) this.layer.visible = false
        return
      }
      // Becoming visible again. If the location changed WHILE the hive was
      // hidden — a shell landing (e.g. the collections page at /sets) navigates
      // into a node before restoring the hive — the mesh still holds the OLD
      // node's tiles. Flipping the layer visible would flash those stale tiles
      // for a frame before the async repaint lands (the blink). Tear the stale
      // mesh down first so the reveal shows the empty ink field, then repaint
      // the current node. When the location is UNCHANGED (screensaver dismiss)
      // the mesh is already correct — reveal instantly, no clear, no regression.
      const currentKey = String(this.resolve<any>('lineage')?.explorerLabel?.() ?? '/')
      if (this.renderedLocationKey && currentKey !== this.renderedLocationKey) {
        this.clearMesh('hive revealed at a new location — drop stale tiles before repaint')
      }
      if (this.layer) this.layer.visible = true
      this.requestRender()
    })

    // render:dive — the wave view asks for another layer's generation to be
    // painted in this page's slots (null = give the page back). Hover rides
    // separately so a pointer move never re-resolves a generation.
    this.onEffect<{ cells?: readonly DiveCell[] | null }>('render:dive', (payload) => {
      void this.#paintDive(payload?.cells ?? null)
    })
    this.onEffect<{ label?: string | null }>('render:dive-hover', (payload) => {
      this.#hoverDive(payload?.label ?? null)
    })

    // viewport:persisted — VP just wrote pan/zoom/meshOffset for some
    // directory. Mirror it into our back-nav cache so navigating-out-and-
    // back sees the latest values WITHOUT a race against an in-flight
    // OPFS write. Without this, the back-nav fast path (line 1383)
    // applies the snapshot from the FIRST visit's OPFS read, undoing any
    // pan/zoom/recenter the user did this session. Symptom: press R,
    // back, in → viewport resets to pre-R; refresh fixes once but
    // back/forth resets again.
    this.onEffect<{ segments: readonly string[]; snapshot: ViewportSnapshot | null }>('viewport:persisted', ({ segments, snapshot }) => {
      // The viewport store just wrote `segments`. If that's the layer we
      // currently have rendered, mirror the post-write snapshot into the
      // back-nav cache so navigating out and back reads the latest values
      // rather than a stale first-visit snapshot.
      const lineage = (window as any).ioc?.get?.('@hypercomb.social/Lineage') as
        { explorerSegments?: () => readonly string[] } | undefined
      const cur = lineage?.explorerSegments?.() ?? []
      const same = Array.isArray(segments)
        && segments.length === cur.length
        && segments.every((s, i) => s === cur[i])
      if (same) {
        this.#layerViewportCache.set(this.renderedLocationKey, { ...(snapshot ?? {}) })
      }
    })

    // tile:saved effect — invalidate only the saved cell's caches and run an
    // incremental render so the rest of the grid stays untouched.
    // tile:preview — the tile editor's edit, painted live onto its own tile.
    // Transient (emitTransient): nothing is cached and nothing replays.
    this.onEffect<TilePreviewPayload>('tile:preview', (payload) => { void this.#applyTilePreview(payload) })

    this.onEffect<{ cell: string }>('tile:saved', (payload) => {
      if (payload?.cell) this.#tilePreviewSavedLabel = payload.cell
      if (payload?.cell) {
        const oldSig = this.#faces.images.get(payload.cell)
        this.#faces.images.delete(payload.cell)
        this.#faces.borders.delete(payload.cell)
        this.#faces.tags.delete(payload.cell)
        this.#faces.links.delete(payload.cell)
        this.#faces.substrates.delete(payload.cell)
        this.#faces.hiddenText.delete(payload.cell)
        if (oldSig && this.imageAtlas) {
          this.imageAtlas.invalidate(oldSig)
        }
      }
      // Fully invalidate cached state and trigger a locked full render.
      // The incremental and in-place fast paths both raced with concurrent
      // synchronize renders, leaving the tile blank. requestRender is
      // serialized via the rendering lock and rebuilds from OPFS.
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // Root properties are live defaults for every same-named appearance.
    // Their outer lineage heads do not move when the root changes, so neither
    // a layer-keyed props cache nor a prepared back-navigation snapshot can
    // notice the dependency on its own. Invalidate this label in every saved
    // projection and force the current view to re-compose root + outer.
    this.onEffect<{ cell: string }>('tile:root-default-changed', (payload) => {
      const label = String(payload?.cell ?? '').trim()
      if (!label) return
      this.#faces.invalidateEverywhere(label)
      // Cached Cell snapshots already contain their previously composed image
      // and display flags. They are cheap to rebuild and cannot be surgically
      // edited without repeating the property projection here.
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // tags:changed — invalidate only the affected cells' tag caches, then run
    // an incremental render to re-emit tag state without touching geometry I/O.
    this.onEffect<{ updates: { cell: string }[] }>('tags:changed', (payload) => {
      if (!payload?.updates) return
      const changedCells: string[] = []
      for (const { cell } of payload.updates) {
        this.#faces.tags.delete(cell)
        changedCells.push(cell)
      }
      if (this.cachedCellNames && changedCells.length > 0) {
        void this.renderIncremental({ changedTags: changedCells })
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey)
        this.renderedCellsKey = ''
        this.requestRender()
      }
      // With the bouquet in hand, a landed scent changes the answer to "who
      // wears the whole set?" — the tile it just landed on must LIGHT. Re-ask
      // now (the tick loop re-asks again after any buffer rebuild, so a lagging
      // index only ever costs a beat, never a stale shade).
      if (this.#armedApplyMarks.length > 0 || this.#markPreviewMarks.length > 0) {
        this.#refreshMarkPreview()
      }
    })

    // tags:indexed — the decoration index finished hydrating tags for cells
    // that were already on screen (the index walks AFTER render:cell-count).
    // Re-aggregate so decoration-backed tags appear in the controls-bar pills
    // without waiting for the next interaction. Cheap: no geometry I/O.
    this.onEffect<{ labels: string[] }>('tags:indexed', (payload) => {
      if (!Array.isArray(payload?.labels) || payload.labels.length === 0) return
      if (this.renderedCells.size === 0) return
      this.#narrow.emitRenderTags([...this.renderedCells.values()])
    })

    // feature:hidden / feature:restored — the participant hid or restored a
    // feature. The decoration-kind index now filters hidden kinds out of its
    // read functions (the one place draw-from-tiles consumers funnel through),
    // so re-render to re-evaluate overlay `visibleWhen` and make the feature's
    // icon disappear / reappear at once. Cheap: a render request, no I/O.
    this.onEffect('feature:hidden', () => this.requestRender())
    this.onEffect('feature:restored', () => this.requestRender())

    // launcher:reconciled — the shared launch-group mix (agg-mix) replaced its
    // committed children (a group was toggled in/out, or a background scan
    // added/removed a site). This must be a HARD reset: deleting only
    // renderedLocationKey misses the agg-mix entry when the pick fires while
    // we're still on the PREVIOUS location (a fresh icon-tap entry — see
    // MixedGroupBag.enter, which emits this BEFORE goRaw). The stale agg-mix
    // cells then survive and the next render serves the previous group's tiles
    // ("switched group but old content / looks hung"). Clear the WHOLE cell
    // cache (we can't cheaply key just the agg-mix entry, and toggles are rare),
    // blank renderedLocationKey so the next pass takes the full location-change
    // gather path, and rebuild the slot set from the fresh children.
    this.onEffect('launcher:reconciled', () => {
      // Supersede any in-flight stream: its cells were gathered from the
      // PREVIOUS union, and left alone it finishes AFTER this reset, painting
      // the old group's tiles and re-seeding the caches we just cleared (the
      // sticky "switched group but old content" bug). Same token bump the
      // cursor-scrub path uses.
      this.#streamToken++
      this.#layerCellsCache.clear()
      this.renderedLocationKey = ''
      this.renderedCellsKey = ''
      this.#slots.clear()
      this.#forceNextRender = true
      this.requestRender()
    })

    // launch:indexed — the decoration index finished hydrating a launcher tile's
    // `shape` AFTER first paint (it walks async, like tags). The silhouette is a
    // per-vertex attribute (aShapeMode) built in applyGeometry, so force a
    // geometry rebuild to pick up the now-known shapes — otherwise the launcher
    // tiles linger as plain hexagons until the next unrelated render.
    this.onEffect('launch:indexed', () => {
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // takeover:indexed — the decoration index learned (live append, removal,
    // or the post-paint hydration walk) that a cell's hex render is REPLACED
    // by a visual-bee view (`replacesTileRender` — the post-it's sticky), or
    // that the claim was lifted. The union filter only runs during a geometry
    // pass, so force one — and FORCE it like title:indexed does: on a busy
    // hive an in-flight stream's dedup swallowed the bare request, and the
    // tile sat beside its sticky for the whole session. The claim and the
    // hex are mutually exclusive; a dropped repaint must not undo that.
    this.onEffect('takeover:indexed', () => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // A roster switch (or a wake-here) changes the ANSWER the takeover filter
    // gets without touching a single decoration, so no index event fires.
    // Re-filter on the same terms, or the hexagon a global-off just handed
    // back stays missing until an unrelated pass.
    this.onEffect(ENABLEMENT_CHANGED, () => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // A frame was bound or released, or the tiles were walked through it.
    // Neither touches a tile's own index — the placement changed without any
    // cell changing — so the same re-place-from-scratch the roster switch
    // needs is the one a frame needs. The layer cache is left alone: the CELLS
    // are identical, only where they sit is different.
    this.onEffect('frame:changed', () => {
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })
    this.onEffect('frame:offset', () => {
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // title:indexed — a cell gained, changed or lost its display title. The
    // atlas keys baked glyphs by the RAW label, so the cached entry still holds
    // the old text; flush it before forcing the geometry rebuild, or the tile
    // keeps drawing its previous name.
    // ONE LABEL, not the whole atlas. The navigation walk emits this once per
    // titled cell, DURING the arrival pass it belongs to — and a full wipe
    // there blanked every name on the page, not just the retitled one: the
    // repaint it asked for was swallowed by the same-target coalescing drop,
    // the in-flight pass wrote a fresh renderedCellsKey over the '' set here,
    // and nothing re-baked. The tiles kept their label bands with no names
    // inside them (the band reads the UV rect, which is still valid — only the
    // pixels behind it were gone). Flushing the one label leaves every other
    // tile's glyphs alone; #forceNextRender keeps the repaint from being
    // dropped, so the retitled cell actually re-bakes under its new name.
    this.onEffect<{ label?: string }>('title:indexed', (payload) => {
      const label = payload?.label
      if (typeof label === 'string' && label) this.atlas?.invalidateLabel(label)
      else this.atlas?.invalidateLabels()
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // reference:indexed — the index resolved a reference tile's FACE from its
    // target, after this page had already painted the tile blank (the pointer
    // is in its layer, the picture is one hop away and read async). The image
    // resolver short-circuits on a cached entry, and the first pass cached
    // "no image" for this label — so drop that entry before rebuilding, or the
    // tile keeps its substrate fallback until an unrelated render evicts it.
    this.onEffect<{ label: string }>('reference:indexed', (payload) => {
      const label = payload?.label
      if (typeof label !== 'string' || !label) return
      this.#faces.images.delete(label)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // A dropped Portal first becomes an in-memory tile at the release slot.
    // Re-render through the normal cell path; clearing the payload removes it
    // without ever having written membership to the layer.
    this.onEffect<ReferenceDraftPreview | null>('reference:draft-preview', (payload) => {
      const previous = this.#referenceDraft
      if (previous?.name && previous.name !== payload?.name) {
        this.#faces.images.delete(previous.name)
        this.atlas?.invalidateLabel(previous.name)
        this.#order.forget(previous.name)
      }
      const name = String(payload?.name ?? '').trim()
      const index = Number(payload?.index)
      this.#referenceDraft = name && Number.isFinite(index) && index >= 0
        ? {
            name,
            index,
            parentSegments: [...(payload?.parentSegments ?? [])],
            ...(typeof payload?.imageSig === 'string' && payload.imageSig ? { imageSig: payload.imageSig } : {}),
          }
        : null
      if (this.#referenceDraft?.imageSig) {
        this.#faces.images.set(this.#referenceDraft.name, this.#referenceDraft.imageSig)
      }
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // fs:changed — bulk OPFS mutation marker. Workers fire this BEFORE
    // committing layer state so that any render triggered by the cascade
    // (cursor.onNewLayer) sees post-mutation OPFS. We use it here to
    // unconditionally drop our caches and re-render — the mutation is a
    // signal that listCellFolders must refetch and the slot machine state
    // is stale (positions may shift, new tiles may have appeared).
    //
    // It fires on navigation too: a different lineage is a different cell set,
    // and the session slot cache is keyed by label (the new cells may share
    // names with the old ones), so a location change also wipes that cache.
    this.onEffect('fs:changed', () => {
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.#slots.clear()
      this.requestRender()
      const lineage = this.resolve<any>('lineage')
      if (String(lineage?.explorerLabel?.() ?? '/') !== this.renderedLocationKey) this.#order.forgetAll()
    })

    // The committer announces persistence separately from membership. The
    // original cell event changes the view immediately; this lifecycle only
    // controls the honest pending shade. A failed commit is accompanied by a
    // compensating cell event, so every open surface converges immediately.
    this.onEffect<{
      cell?: string
      segments?: readonly string[]
      op?: 'add' | 'remove'
      state?: 'pending' | 'settled' | 'failed'
    }>('cell:mutation-state', (payload) => {
      const cell = String(payload?.cell ?? '').trim()
      if (!cell) return
      if (payload.segments && !this.#segmentsAreCurrent(payload.segments)) return
      if (payload.state === 'pending' && payload.op === 'add') {
        this.#pendingCellMutations.add(cell)
        this.#readiness.dim(cell)
      } else {
        this.#pendingCellMutations.delete(cell)
      }
      if (this.#slots.seeded) this.#queueIncremental({})
    })

    // A References composition writes its children while another layer is on
    // screen, then returns here. The membership events invalidate the right
    // caches but cannot flip a slot that was not mounted at that moment. Once
    // the parent has painted, this render-only arrival signal is conclusive
    // proof that the target is a branch, so its first click enters it.
    this.onEffect<{ segments?: readonly string[] }>('reference:branch-ready', payload => {
      const segments = payload?.segments
      if (!segments?.length) return
      this.#invalidatePreparedViewsFor(segments)
      this.#layerCellsCache.clear()
      this.#flipParentBranchFor(segments)
    })

    // cell:added / cell:removed — synchronous incremental path. Zero awaits
    // in the click handler. The slot state machine mutates immediately, the
    // next microtask runs one applyGeometry, and images for new cells are
    // loaded fire-and-forget afterward. Rapid clicks in one JS turn coalesce
    // into a single render.
    this.onEffect<{ cell: string; segments?: string[]; groupId?: string }>('cell:added', (payload) => {
      if (!payload?.cell) return
      // A child gaining its FIRST child flips its branch-status AS SEEN FROM ITS
      // PARENT — but per-page history commits only the leaf (the child's own
      // layer), never re-committing the parent, so the parent's content sig is
      // unchanged and its #completeChildNamesByParentSig entry still lists this
      // child as a leaf. On a later memo HIT that stale branch-set is re-served
      // and freshenBranches never re-runs, so the parent's tile paints with no
      // branch dot and refuses to navigate in. Drop the whole memo (a pure perf
      // cache; re-resolution runs warm right after an edit) so the parent
      // re-derives branch-status on its next render. Cleared BEFORE the
      // current-location guard below so an add at ANY location invalidates a
      // possibly-ancestor entry. branchByHeadSig is intentionally NOT cleared —
      // it is keyed by the immutable head sig, so a changed head is just a miss.
      // TARGETED: only the ancestors of the add can have a stale branch dot.
      // Dropping EVERY prepared view (what this used to do) threw away the
      // entire session's preloading on a single tile creation — anywhere.
      this.#invalidatePreparedViewsFor(payload.segments)
      // The memo clear above only heals the SLOW render path. Back-nav restores
      // a parent location SYNCHRONOUSLY from #layerCellsCache — a SEPARATE cache
      // the fast path paints VERBATIM, cell-by-cell hasBranch flags included,
      // never re-resolving branch-status. Those flags were captured when the
      // parent last rendered, with this child still a LEAF; so after the child
      // gains its first grandchild, the parent's cached cells still mark it
      // hasBranch=false. #buildCellCountPayload then omits it from branchLabels,
      // and the tile-overlay routes its click to the 'open' editor action
      // instead of #navigateInto — the branch is un-enterable until a full
      // reload drops the in-memory cache ("can't click into the branch until I
      // refresh"). Invalidate the fast-path cache alongside the memo. Same
      // perf-cache rationale (it re-warms on the next render) and same reason
      // it's cleared BEFORE the location guard: an add at a DESCENDANT location
      // still flips an ancestor's branch dot.
      this.#layerCellsCache.clear()
      // Only react to additions at the location we're currently showing.
      // One create can emit cell:added for several locations at once — a
      // nested `a/b/c` adds a child to root, /a AND /a/b — and the tiles for
      // the other locations must NOT appear in this view. When segments are
      // absent (legacy emitters) we assume the current location.
      if (payload.segments && !this.#segmentsAreCurrent(payload.segments)) {
        // A child added ONE level below this screen is deterministic proof
        // that its parent tile — visible HERE — is now a branch. Flip it
        // synchronously from the event itself: the eager async branch check
        // (checkCellHasBranch in the incremental fill) races importTree and
        // usually reads OPFS before the child bag exists, so a command-line
        // `abc/123` left `abc` painted as a leaf — omitted from branchLabels,
        // click routed to the editor instead of #navigateInto, un-enterable
        // until refresh. No OPFS read needed: the event IS the proof.
        this.#flipParentBranchFor(payload.segments)
        return
      }
      this.#pendingRemoves.delete(payload.cell)
      this.#startNewCellFade(payload.cell)
      // Empty → first item has no mesh yet, but the event itself is complete
      // membership truth. Seed the empty pinned projection synchronously so
      // the first tile takes the same next-frame path as every later add.
      // Falling through to requestRender here used to pay the whole history
      // read and made the very first add take 0.8–1.5s in Playwright.
      if (!this.#slots.seeded && this.renderedCells.size === 0) {
        const axial = this.resolve<any>('axial')
        if (axial?.items) {
          this.#slots.seed({
            names: [],
            localCells: new Set<string>(),
            branches: new Set<string>(),
            mode: 'pinned',
          })
        }
      }
      if (this.#slots.seeded) {
        // Capture the address NOW, synchronously with the event — the
        // incremental placement defers via microtask and its index write
        // must use the location where this add actually happened.
        const lineage = this.resolve<any>('lineage')
        const addSegments: readonly string[] = payload.segments ?? lineage?.explorerSegments?.() ?? []
        this.#queueIncremental({ added: [{ name: payload.cell, segments: addSegments }] })
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey)
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    this.onEffect<{ cell: string; groupId?: string }>('cell:removed', (payload) => {
      if (!payload?.cell) return
      // Symmetric to cell:added: a child losing its LAST child flips it back to
      // a leaf, and the parent is not re-committed, so its cached branch-set is
      // stale. Invalidate the parent-branch memo so the (now stale) branch dot
      // is re-derived on the next render. See the cell:added note above.
      // TARGETED, same as cell:added — a removal invalidates its ancestors,
      // not every prepared view in the session.
      this.#invalidatePreparedViewsFor((payload as { segments?: readonly string[] }).segments)
      // Same back-nav fast-path staleness as cell:added: a child losing its LAST
      // grandchild flips branch→leaf, but the parent's #layerCellsCache entry
      // still marks it a branch (a stale dot + a click that drills into a now-
      // empty layer) until reload. Invalidate the fast-path cache alongside the
      // memo. See the cell:added note.
      this.#layerCellsCache.clear()
      this.#pendingRemoves.add(payload.cell)
      this.#faces.images.delete(payload.cell)
      this.#faces.tags.delete(payload.cell)
      this.#faces.links.delete(payload.cell)
      this.#faces.borders.delete(payload.cell)
      this.#faces.substrates.delete(payload.cell)
      this.#faces.hiddenText.delete(payload.cell)
      if (this.#slots.seeded) {
        this.#queueIncremental({ removed: [payload.cell] })
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey)
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    // history:cursor-changed — re-render when cursor moves to a different
    // layer. Every undo/redo step is a different layer, so we must re-render
    // each time. When cursor is at head and a NEW layer arrives (not a cursor
    // move), the incremental cell:added / cell:removed path has already
    // reconciled the view, so we skip to avoid wiping in-flight work.
    // Prune mode swaps the layer under this location (see the override in
    // the render pass). Entering, leaving, and every purge change what the
    // hive is showing, so each one is a repaint — and it has to be a FORCED
    // one: the location and its revision are both unchanged, so the
    // unchanged-page fast path at the top of renderFromSynchronize would
    // otherwise drop the pass before any layer is read (the mode toggled
    // and the hive kept painting the live tiles).
    //
    // The back-nav cells cache is dropped for this location in the same
    // breath. It is keyed by location alone, so an entry written while the
    // ghosts were on screen would restore DELETED tiles onto a live page
    // the next time the participant walked back here.
    this.onEffect<{ active?: boolean }>('prune:mode-changed', () => {
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.#faces.images.clear()
      this.#forceNextRender = true
      this.renderedCellsKey = ''
      this.requestRender()
    })

    this.onEffect<CursorState>('history:cursor-changed', (state) => {
      const nowRewound = state?.rewound ?? false
      const nowPosition = state?.position ?? -1
      const nowLocationSig = state?.locationSig ?? ''

      // CRITICAL: cursor.load() resets position to layers.length for each
      // new location, so cursor-changed fires on EVERY navigation with a
      // "new" position relative to the previous location. Without this
      // location-aware guard, every back-nav (from /alpha to /) would
      // wipe #layerCellsCache via clear() below — and the eager-cache
      // fix would be defeated immediately. We only treat this as an
      // actual cursor move (which legitimately invalidates per-label
      // derived state) when locationSig is unchanged: same layer, real
      // undo/redo or seek. A different locationSig means navigation —
      // ShowCellDrone's own back-nav fast path / slow path handles the
      // layer switch; cursor-changed must keep its hands off the cache.
      if (nowLocationSig !== this.#lastCursorLocationSig) {
        // Adopt the new location's cursor state silently, no cache wipe.
        this.#lastCursorLocationSig = nowLocationSig
        this.#lastCursorPosition = nowPosition
        this.#lastCursorRewound = nowRewound
        return
      }

      // Head-advancing COMMIT (not a scrub). importTree's onNewLayer bumps
      // the cursor to a higher position with rewound still false whenever a
      // new layer is appended while we're at head — which is EVERY create.
      // The incremental cell:added / cell:removed path has already
      // reconciled this view, so wiping the caches and running a full
      // renderFromSynchronize below is pure redundant work: a second
      // full-grid OPFS re-read + rebuild right after the cheap incremental
      // render already painted. That redundant render is the residual
      // create lag. Adopt the new position silently — exactly like the
      // navigation branch above. This is the skip the comment at the top of
      // this handler always intended but never implemented.
      //
      // Genuine scrubs still fall through to the full re-render: undo has
      // nowRewound=true; redo and redo-to-head / Make-HEAD have the PREVIOUS
      // state rewound (#lastCursorRewound=true), so !#lastCursorRewound
      // excludes them. Only a was-at-head → still-at-head → position-up
      // transition (a fresh commit) is skipped.
      if (!nowRewound && !this.#lastCursorRewound && nowPosition > this.#lastCursorPosition) {
        this.#lastCursorPosition = nowPosition
        this.#lastCursorRewound = nowRewound
        return
      }

      // Same location — was this an actual scrub?
      if (nowPosition === this.#lastCursorPosition && nowRewound === this.#lastCursorRewound) return
      this.#lastCursorPosition = nowPosition
      this.#lastCursorRewound = nowRewound
      this.#layerCellsCache.clear()
      // Every per-label cache is keyed by cell label, not by content
      // signature. On a cursor move the effective propsSig for each
      // label changes (historical while rewound, live at head), so the
      // caches must be dropped or the view stays stuck on first-loaded
      // state. Invalidating through a single helper keeps the six
      // label-keyed maps in lock-step; longer term these collapse into
      // one propsSig-keyed derived-state cache.
      this.#faces.clear()
      this.renderedCellsKey = ''
      // Supersede any in-flight stream on this same layer. Cursor moves
      // do not change locationKey, so the layer-change branch of
      // renderFromSynchronize won't fire — but the streaming render
      // that started before the undo still references the pre-undo
      // cells / props. Bumping the token makes that stream bail out at
      // its next iteration so it cannot overwrite the post-undo mesh
      // with stale cells. Without this, undo/redo during a still-
      // streaming layer leaves some tiles rendered from the old state
      // (image missing, label from the other branch) until the next
      // explicit layer change.
      this.#streamToken++
      // The re-render itself is scheduled by the requestRender() below
      // (renderedCellsKey was cleared above, so the fast-path skip can't
      // swallow it). This used to ALSO call renderFromSynchronize()
      // directly — the only call site that bypassed requestRender's
      // body serialization. A direct body interleaving with a queued
      // body mid-await re-entered the layer-change block against a
      // repointed renderedLocationKey and repainted the OLD page over
      // the new one. One scheduler, one queue: requestRender only.

      // Preserve viewport (scale + pan) across the undo/redo re-render.
      // Snapshot stage / container transforms before requestRender and
      // restore after, in case any other path nudges them. Mesh recenter
      // is off by default now (one-shot opt-in via #pendingRecenter), so
      // no flag set is needed here.
      const app = this.pixiApp as any
      const cont = this.pixiContainer as any
      const snap = (app && cont) ? {
        stagePos: { x: app.stage.position.x, y: app.stage.position.y },
        contPos:  { x: cont.position.x,      y: cont.position.y      },
        contScale:{ x: cont.scale.x,         y: cont.scale.y         },
      } : null
      this.requestRender()
      if (snap && app && cont) {
        // Restore on the next microtask so requestRender's queued
        // render runs against the original transforms. The render
        // itself will read the snapshot values; nothing in the
        // render path mutates them under the suppress flag.
        queueMicrotask(() => {
          app.stage.position.set(snap.stagePos.x, snap.stagePos.y)
          cont.position.set(snap.contPos.x, snap.contPos.y)
          cont.scale.set(snap.contScale.x, snap.contScale.y)
        })
      }
    })

    // search:filter effect — live-filter visible tiles by keyword
    // (the `>?` command-line mode, typed live).
    //
    // A filter change moves NEITHER the location nor the cells-key, so
    // requestRender alone hit renderFromSynchronize's fast-path skip
    // (`locationKey === renderedLocationKey && renderedCellsKey !== ''`)
    // and returned without a pass: the keyword landed on the field and
    // the hive never repainted. Clearing the key is what makes the
    // keystroke visible. The per-location cells cache is dropped too —
    // a filtered pass writes its NARROWED set into #layerCellsCache, and
    // the back-nav fast path would otherwise restore that narrowed set
    // at a location whose filter has since been cleared.
    this.onEffect<{ keyword: string }>('search:filter', ({ keyword }) => {
      const next = String(keyword ?? '').trim().toLowerCase()
      if (next === this.filterKeyword) return
      this.filterKeyword = next
      this.renderedCellsKey = ''
      this.#layerCellsCache.clear()
      // Typing is FASTER than a render pass. Keystroke N+1 lands while the
      // pass for keystroke N is still in flight (or its streamCells is still
      // running async), and the dedup guard below DROPS that render outright
      // — nothing is queued behind it, so the last keyword typed never
      // repaints and the filter looks completely dead at human typing speed.
      // A filter change is a forced invalidation for exactly the reason the
      // flag exists: the in-flight pass gathered its cells before the keyword
      // changed, so its result is already stale. Arming it makes the drop
      // path re-queue instead of swallow.
      this.#forceNextRender = true
      this.requestRender()
    })

    // tags:removal-pending — TagRemovalDrone's staged set for the keyword being
    // removed. Purely visual: the staged tiles paint as future-removes so the
    // pending change is legible on the hive itself, not only in the panel's
    // list. No geometry moves; only the divergence attribute rebakes.
    this.onEffect<{ cells?: string[] }>('tags:removal-pending', ({ cells }) => {
      const next = new Set(Array.isArray(cells) ? cells : [])
      if (next.size === this.#tagRemovalStaged.size
        && [...next].every(l => this.#tagRemovalStaged.has(l))) return
      this.#tagRemovalStaged = next
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // tags:apply-pending — the bouquet in hand. TWO visual duties from one
    // sticky payload:
    //   • the ARMED SHADE (#armedApplyMarks): tiles wearing the whole set stay
    //     lit in the bouquet's colour, every tile missing part of it recedes —
    //     the standing "click here to scent" readout;
    //   • the staged future-ADD marks (`cells`, the selection one-shot) — same
    //     purely-visual contract as the removal staging above, opposite sign.
    this.onEffect<{ cells?: string[]; active?: boolean; tags?: string[]; color?: string }>(
      'tags:apply-pending', ({ cells, active, tags, color }) => {
        const armed = active === false
          ? []
          : (Array.isArray(tags) ? tags.map(t => String(t ?? '').trim()).filter(Boolean) : [])
        if (color) this.#armedApplyColor = previewRgb(color)
        if (armed.length !== this.#armedApplyMarks.length
          || armed.some((m, i) => m !== this.#armedApplyMarks[i])) {
          this.#armedApplyMarks = armed
          this.#refreshMarkPreview()
        }
        const next = new Set(active === false ? [] : (Array.isArray(cells) ? cells : []))
        if (next.size === this.#tagApplyPainted.size
          && [...next].every(l => this.#tagApplyPainted.has(l))) return
        this.#tagApplyPainted = next
        this.renderedCellsKey = ''
        this.requestRender()
      })

    // drop:dragging — a pheromone (or bouquet) is riding the cursor out of
    // the panel. While `marks` are aboard, shade exactly as the armed set
    // does: the tiles the drop would change recede, the ones already wearing
    // it all stay lit. Emitters without marks (file drops, the aggregate
    // index) change nothing here.
    this.onEffect<{ active?: boolean; marks?: string[]; color?: string }>('drop:dragging', ({ active, marks, color }) => {
      const held = active === true && Array.isArray(marks)
        ? marks.map(m => String(m ?? '').trim()).filter(Boolean)
        : []
      if (held.length === 0 && this.#dragShadeMarks.length === 0) return
      if (color) this.#dragShadeColor = previewRgb(color)
      this.#dragShadeMarks = held
      this.#refreshMarkPreview()
    })

    // ── THE TAKE'S TOUCH ─────────────────────────────────────────────
    // The swarm's shade is a STANDING state now (#cellIsShaded), so there is
    // nothing for a modifier to arm: what you don't own is dim the whole
    // time you stand among it.
    // swarm:wand — a take touched this tile (transient, one per tile per
    // gesture: the click that walks in, or a ctrl sweep). Lift it out of the
    // shade NOW and stamp the taking rim; the fold lands behind it and the
    // next render paints it native — yours, permanently, at full strength.
    this.onEffect<{ label?: string }>('swarm:wand', ({ label }) => {
      const l = String(label ?? '').trim()
      if (l) this.#flashWandTake(l)
    })

    // The peer-divergence scan re-answered "which held tiles have an update
    // to take". That answer is part of the shade now (#cellIsShaded), so
    // rewrite every rendered cell's shade attribute in place — the scan is a
    // debounced, page-scoped event, and an attribute sweep is exactly what a
    // hover already does per cell. Never a render:cell-count emit (that
    // payload doubles as the navigation-guard release).
    this.onEffect('swarm:divergence-changed', () => {
      for (const label of this.renderedCells.keys()) this.#writeShadeFor(label)
    })

    // tags:preview — a pheromone is under the cursor in the chrome (a panel
    // row, a bouquet, a bottom crumb). A hovered mark asks ONE question —
    // which tiles carry this? — and the hive is the only surface that can
    // answer it, so it answers there: every carrier on the page lights in the
    // mark's own colour and the rest of the page recedes behind them. Purely a
    // look: nothing is written, nothing is staged, nothing is armed, and
    // leaving the mark puts the page back exactly as it was.
    this.onEffect<{ marks?: readonly string[]; color?: string }>('tags:preview', ({ marks, color }) => {
      const next = (Array.isArray(marks) ? marks : []).map(m => String(m ?? '').trim()).filter(Boolean)
      const rgb = color ? previewRgb(color) : null
      if (rgb) this.#markPreviewColor = rgb
      if (next.length === this.#markPreviewMarks.length
        && next.every((m, i) => m === this.#markPreviewMarks[i])) return
      this.#markPreviewMarks = next
      this.#refreshMarkPreview()
    })

    // A programmatic mark change (e.g. /mobile sweep) deposits tags via
    // DecorationService directly, bypassing the painter's tags:apply
    // invalidation. Clear the render cache so tag chips refresh without
    // needing a navigation. (Marks are curation data only — they no longer
    // filter what renders; tiles are universal.)
    this.onEffect('mobile:marks-changed', () => {
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // render:gather-set — paint THESE tiles, wherever in the hive they live.
    //
    // The predicate lane (`tags:filter`) answers "what matches?"; this answers
    // "show me this list", which is what a caller holding the answer already
    // needs. It rides the same flatten render, so a gathered tile keeps its
    // absolute path and a click travels to its real home. Every gathered tile
    // is treated as a branch so that click IS an entry on desktop too — from an
    // audit, pressing a tile means "take me to it", not "open its editor".
    //
    // Nothing is committed. No layer is minted, no lineage is written; sending
    // an empty list (or walking anywhere) puts the hive back as it was.
    this.onEffect<{ key?: string; items?: Array<{ label?: string; path?: string[] }> }>(
      'render:gather-set', ({ key, items }) => this.#narrow.gather(key, items))

    // tags:required — the marks a REFERENCE demands of what it shows, ANDed
    // with the lens (tile-narrowing.ts).
    this.onEffect<{ marks?: string[] }>('tags:required', ({ marks }) => this.#narrow.require(marks))

    // tags:filter — the lens, scoped to page / children / global.
    this.onEffect<{ active: string[]; scope?: 'local' | 'children' | 'global' }>('tags:filter', ({ active, scope }) => this.#narrow.filter(active, scope))

    // move:preview — reordered names during drag (fast path avoids full OPFS re-read)
    this.onEffect<{ names: string[]; movedLabels: Set<string> } | null>('move:preview', (payload) => {
      this.moveNames = payload?.names ?? null
      this.renderedCellsKey = '' // force geometry rebuild
      if (payload && this.cachedCellNames) {
        // fast path: reuse cached render context, only rebuild geometry with swapped labels
        this.renderMovePreview()
      } else {
        // clearing move preview or no cache — full render
        this.requestRender()
      }
    })

    // listen for pixi host readiness via effect bus
    this.onEffect<HostReadyPayload>('render:host-ready', this.adoptHostPayload)

    // listen for orientation change
    this.onEffect<{ flat: boolean }>('render:set-orientation', (payload) => {
      if (this.#flat !== payload.flat) {
        this.#flat = payload.flat
        // invalidate image cache since we need different snapshots
        this.#faces.images.clear()
        this.#layerCellsCache.clear()
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    // THE SLOT GRID CHANGED SHAPE — the phone's rails were projected into (or
    // released from) AxialService, so slot i now means a different place.
    // Same invalidation as an orientation flip: every cached placement was
    // read against the old grid.
    this.onEffect<{ active?: boolean }>('render:grid-changed', () => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // listen for space (room) and secret changes — recompute signature.
    // Both also drop #layerCellsCache: room+secret are half the swarm gate,
    // so crossing them changes MEMBERSHIP (the swarm-privacy filter starts or
    // stops dropping unshared tiles) and flips the zone-scoped hide keys.
    // Blanking renderedLocationKey alone makes the next pass look like a NAV
    // pass, which takes the synchronous cached-cells fast path (:2156) and
    // would repaint the pre-join cells — unfiltered — until something else
    // invalidated. Credential changes are rare; re-deriving the cells is cheap.
    this.onEffect<{ room: string }>('mesh:room', ({ room }) => {
      if (this.#mesh.room !== room) {
        this.#mesh.room = room
        this.#layerCellsCache.clear()
        this.renderedCellsKey = ''
        this.renderedLocationKey = ''
        this.requestRender()
      }
    })

    this.onEffect<{ secret: string }>('mesh:secret', ({ secret }) => {
      if (this.#mesh.secret !== secret) {
        this.#mesh.secret = secret
        this.#layerCellsCache.clear()
        this.renderedCellsKey = ''
        this.renderedLocationKey = ''
        this.requestRender()
      }
    })

    // clipboard:view page-replacement REMOVED — the clipboard is now a
    // non-navigating side panel (hc-clipboard-panel) that never takes over
    // the page render. The old listener, the `#clipboardView` field, and all
    // its render-path guards are gone.

    // ── THE SWAP HOVER ────────────────────────────────────────────────
    // While the clipboard window is open a click MOVES the hovered tile, so
    // its hover ring must not go on promising navigation. The verb is
    // resolved in exactly one place — TileOverlayDrone's cue, which also
    // draws the pill above the hex — and pushed here, so the pill and the
    // rim can never disagree about what the click is about to do.
    this.onEffect<{ verb: 'take' | 'copy' | 'enter' | null; color?: number }>('clipboard:verb', (payload) => {
      const verb = payload?.verb ?? null
      this.#swapMode = verb === 'enter' ? 3 : verb === 'copy' ? 2 : verb === 'take' ? 1 : 0
      if (payload?.color !== undefined) {
        const c = payload.color
        this.#swapColor = [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255]
      }
      this.#applySwapMode()
    })

    // clipboard:captured — brief visual flash on copied tiles. Heat-only
    // change → in-place buffer update, no full re-render.
    this.onEffect<{ labels: string[]; op: string }>('clipboard:captured', (payload) => {
      if (!payload?.labels?.length) return

      if (payload.op === 'copy') {
        if (this.#flashTimer) clearTimeout(this.#flashTimer)
        this.#flashLabels = new Set(payload.labels)
        for (const label of payload.labels) {
          this.#heatByLabel.set(label, 1.0)
          this.#updateCellHeat(label, 1.0)
        }

        this.#flashTimer = setTimeout(() => {
          for (const label of this.#flashLabels) {
            this.#heatByLabel.delete(label)
            this.#updateCellHeat(label, 0)
          }
          this.#flashLabels.clear()
          this.#flashTimer = null
        }, 600)
      }
      // cut: tiles disappear via history remove ops + synchronize (handled by ClipboardWorker)
    })

    // translation:tile-start — sustained heat glow while translating.
    // Heat-only → in-place buffer update on each pulse, no geometry rebuild.
    this.onEffect<{ labels: string[]; locale: string }>('translation:tile-start', (payload) => {
      if (!payload?.labels?.length) return
      for (const label of payload.labels) {
        this.#translatingLabels.add(label)
        this.#heatByLabel.set(label, 0.5)
        this.#updateCellHeat(label, 0.5)
      }

      if (!this.#translationPulseTimer) {
        this.#translationPulseTimer = setInterval(() => {
          if (!this.#translatingLabels.size) {
            clearInterval(this.#translationPulseTimer!)
            this.#translationPulseTimer = null
            return
          }
          const t = Date.now() / 1000
          const pulse = 0.3 + 0.2 * Math.sin(t * 3)
          for (const label of this.#translatingLabels) {
            this.#heatByLabel.set(label, pulse)
            this.#updateCellHeat(label, pulse)
          }
        }, 100)
      }
    })

    // translation:tile-done — clear heat on a single tile in place.
    this.onEffect<{ label: string }>('translation:tile-done', (payload) => {
      if (!payload?.label) return
      this.#translatingLabels.delete(payload.label)
      this.#heatByLabel.delete(payload.label)
      this.#updateCellHeat(payload.label, 0)
    })

    // locale:changed — flush label atlas so all tile labels re-resolve through i18n.
    // Forced for the same reason as title:indexed: a wipe with a swallowed
    // repaint leaves every name blank behind its band.
    this.onEffect<{ locale: string }>('locale:changed', () => {
      if (this.atlas) {
        this.atlas.invalidateLabels()
      }
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // labels:invalidated — fresh translations registered for current locale; re-resolve atlas.
    this.onEffect<{ locale: string }>('labels:invalidated', () => {
      if (this.atlas) {
        this.atlas.invalidateLabels()
      }
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // cell from persisted stores so secret/room survive page reload
    const roomStore = get<any>('@hypercomb.social/RoomStore')
    const secretStore = get<any>('@hypercomb.social/SecretStore')
    if (roomStore?.value && this.#mesh.room !== roomStore.value) {
      this.#mesh.room = roomStore.value
      this.renderedLocationKey = ''
    }
    if (secretStore?.value && this.#mesh.secret !== secretStore.value) {
      this.#mesh.secret = secretStore.value
      this.renderedLocationKey = ''
    }

    // listen for public/private toggle — clear mesh cells when going private so
    // external tiles disappear immediately without requiring a manual refresh
    this.onEffect<{ public: boolean }>('mesh:public-changed', ({ public: isPublic }) => {
      this.#publicMode = !!isPublic
      if (!isPublic) {
        this.#mesh.clearPeers()
        // Leaving the swarm: presence glow is meaningless in private mode.
        this.#presenceGlowByLabel.clear()
      }
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // The DOM name layer draws the glyphs while it is mounted; the shader keeps
    // the band behind them. Last-value replay covers either boot order.
    this.onEffect<{ on: boolean }>('tile-names:dom', (p) => {
      this.#domNames = !!p?.on
      this.shader?.setGlyphs(this.#domNames ? 0 : 1)
    })

    // listen for pivot mode toggle (loads pre-rotated snapshots + rotated labels)
    this.onEffect<{ pivot: boolean }>('render:set-pivot', (payload) => {
      if (this.#pivot !== payload.pivot) {
        this.#pivot = payload.pivot
        this.atlas?.setPivot(payload.pivot)
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    this.onEffect<{ textOnly: boolean }>('render:set-text-only', (payload) => {
      if (this.#textOnly !== payload.textOnly) {
        this.#textOnly = payload.textOnly
        this.shader?.setImageMix(payload.textOnly ? 0.0 : 1.0)
        cancelAnimationFrame(this.#substrateFadeRaf)
        this.#substrateFadeStart = null
        // The mode decides whether a hideText tile hides anything (#hidesName),
        // so every labelUV has to be re-derived — the cells themselves are
        // unchanged, so clear the key the way the pivot toggle does or the
        // render short-circuits and hidden names stay hidden with no image
        // behind them.
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    // substrate fade-in: when substrate config changes, animate images from 0 → 1
    this.onEffect('substrate:changed', () => {
      this.#startSubstrateFade()
    })

    // substrate:ready — substrate.service.warmUp() has finished and the props
    // pool is populated. Force a render that re-emits render:cell-count with
    // the current noImageLabels; substrate.drone listens for that and assigns
    // images to every still-blank cell, then emits substrate:applied (below).
    //
    // Clearing renderedCellsKey is critical: without it, the next render
    // would short-circuit at the cellsKey-equality check because no cell has
    // gained an imageSig yet (chicken-and-egg with substrate apply), and
    // render:cell-count would never re-fire.
    this.onEffect('substrate:ready', () => {
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // SwarmDrone fires this when a peer arrives or its layer changes
    // (and again on mesh-public toggling off, with reason='mode-private',
    // so the cleared peer state surfaces as an empty TileSourceRegistry
    // contribution and temp shared tiles disappear). show-cell's mesh
    // callback no longer reacts to swarm-kind events directly — this
    // drone-to-drone effect is the explicit handoff that triggers the
    // repaint exactly when peer state actually changed.
    //
    // Aggressive invalidation: clearing cellsKey alone wasn't enough —
    // the back-nav fast path matches by locationKey and serves a stale
    // cells cache that doesn't reflect the new peer entries. Clear the
    // location key + layer-cells cache for the current location so the
    // next render runs the full path (lists local cells, queries the
    // registry, includes peer additions, re-seeds the slot machine).
    this.onEffect('swarm:peers-changed', () => {
      // A newly-published (or retracted) peer tile must repaint without a
      // reload. The render reads its cell-name list from the SLOT STATE
      // MACHINE (#slots), seeded once and reused across passes — so clearing
      // only the layer/source caches wasn't enough: requestRender re-read
      // the stale slot snapshot and the new peer tile never appeared (and a
      // retracted one lingered) — the "can't adopt a newly-offered swarm
      // tile" bug. This mirrors the proven `fs:changed` handler EXACTLY,
      // whose `#slots.clear()` is the piece that forces a fresh seed.
      // #layerCellsCache/#sourceEntriesCache are cleared unconditionally
      // (not keyed by the often-empty renderedLocationKey) so the next pass
      // takes the full path and re-resolves peers; the emit is debounced
      // ~150ms upstream, so this is one rebuild per burst.
      this.#layerCellsCache.clear()
      this.#sourceEntriesCache.clear()
      this.renderedCellsKey = ''
      this.#slots.clear()
      this.requestRender()
    })

    // Participant filter toggled — the peer tile set changes exactly like
    // a peers-changed burst, so mirror that handler's FULL invalidation
    // (slot machine included): anything less and a stale slot snapshot
    // keeps unselected peers painted, or a re-selected peer never
    // reappears. The source-side filter (swarm.drone) reads the service
    // directly, so clearing the caches is all the render needs.
    this.onEffect<{ participants?: readonly string[] }>('swarm:filter', (payload) => {
      const next = new Set((payload?.participants ?? []).map(p => String(p)).filter(Boolean))
      const same = next.size === this.#participantFilter.size
        && [...next].every(p => this.#participantFilter.has(p))
      if (same) return
      this.#participantFilter = next
      this.#layerCellsCache.clear()
      this.#sourceEntriesCache.clear()
      this.renderedCellsKey = ''
      this.#slots.clear()
      this.requestRender()
    })

    // Spotlight changes — a peer's layer was surfaced (or dismissed
    // back to merged). This is a LAYER move, not a tint: a surfaced
    // participant supplies their own version of every tile you both
    // hold, at their own slot indices, so membership and ordering are
    // recomputed and not just the borderColor path. Clear the derived
    // caches the same way the participant filter does — leaving
    // #layerCellsCache/#slots warm would paint the new layer's pictures
    // into the old layer's arrangement.
    this.onEffect<{ activePeer: string | null }>('spotlight:changed', (payload) => {
      this.#spotlightPubkey = payload?.activePeer ?? null
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.#slots.clear()
      this.requestRender()
    })

    // Peer presence/interest moved — someone entered (or left) one of the
    // child tiles at this location. Recompute the presence glow and force
    // a rebuild so the heat ring updates. Cheap: same cells, only the heat
    // attribute changes. renderedCellsKey is cleared because buildCellsKey
    // doesn't hash heat, so without this the pass would short-circuit.
    this.onEffect('swarm:interest-changed', () => {
      if (!this.#publicMode) return
      this.#refreshPresenceGlow()
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // substrate:applied — substrate has just written a new propsSig for this
    // cell. Only this one cell's imageSig changed; route through the in-place
    // buffer update so the rest of the grid never repaints. If the cell isn't
    // currently indexed (e.g. first-render race), fall back to incremental.
    //
    // Cache invalidation must NOT precede the reload. Deleting
    // cellImageCache[cell] up front and then awaiting loadCellImages
    // leaves a window where any concurrent render (another effect
    // fires, requestRender runs) reads an empty cache, produces
    // `cell.imageSig = undefined`, and buildFillQuadGeometry bakes
    // `hasImage = 0` into the buffer — permanently, because subsequent
    // renders see the same cellsKey and skip the rebuild. Keep the old
    // cache entry live until #tryInPlaceCellUpdate has re-read props
    // and re-populated it; any concurrent render then sees the stale-
    // but-valid sig and renders the previous image instead of an empty
    // tile. When the update finishes, the buffer is patched in place
    // with the new sig.
    this.onEffect<{ cell: string }>('substrate:applied', (payload) => {
      if (!payload?.cell) return
      void this.#tryInPlaceCellUpdate(payload.cell, { dir: null }).then(done => {
        this.#faces.substrates.delete(payload.cell)
        if (!done && this.#slots.seeded) {
          this.#faces.images.delete(payload.cell)
          void this.renderIncremental({ changedContent: [payload.cell] })
        }
      })
    })

    // tile:hidden / tile:unhidden — instant local response to the
    // user clicking the hide icon. localStorage has already been
    // written by tile-actions; show-cell wipes its render caches and
    // re-renders so the tile disappears (or reappears) without the
    // user waiting for the swarm round-trip. The mesh publish + relay
    // echo arrive moments later via swarm:hide-changed and are no-op
    // because the cache is already clear. Pattern matches the delete
    // path (cell:removed handler) — instant repaint, no waiting on
    // network or processor pulse.
    const invalidateForHide = (): void => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
    }
    this.onEffect<{ cell: string; location: string }>('tile:hidden', invalidateForHide)
    this.onEffect<{ cell: string; location: string }>('tile:unhidden', invalidateForHide)

    // swarm:hide-changed — a hide event for the current lineage just
    // landed (could be our own echo on first reload, or a multi-device
    // sync from another tab signed by the same pubkey). Same render
    // path as the local tile:hidden — the union read picks up
    // whichever source has new names.
    this.onEffect<{ sig: string; pubkey: string }>('swarm:hide-changed', invalidateForHide)

    // swarm:resource-arrived — the swarm pipeline just wrote a peer's
    // image bytes (or nested propsSig blob) to local OPFS. A tile whose
    // image was previously unresolved (referenced sig wasn't yet on
    // disk, so the renderer drew a blank) can now be painted.
    //
    // Two patterns of stale per-cell state need to be cleared so the
    // next render actually picks up the freshly-streamed bytes:
    //
    //   1. cellImageCache[label] === arrivedSig — the cell knows its
    //      image sig, the atlas just didn't have it. After clearing,
    //      the slow path will re-call loadImageOnce(sig) and bind the
    //      atlas slot. The buildCellsKey hash includes imageSig and
    //      the atlas eviction generation, so applyGeometry will see
    //      a changed key and rebuild the UV buffer.
    //
    //   2. cellImageCache[label] === null — the previous resolve gave
    //      up (no propsIndex, or propsBlob fetch failed). The arriving
    //      sig may be the propsBlob a peer just published, or the
    //      small.image bytes inside one. Either way, the next slow
    //      path needs a chance to re-resolve, so clearing the null
    //      entry is the unblock.
    //
    // Plain `requestRender()` alone is insufficient because the
    // fast-path skip in renderFromSynchronize honors renderedCellsKey;
    // if a render is in flight when this effect fires, the in-flight
    // render writes renderedCellsKey at completion and the do-while
    // re-render sees it non-empty and returns early. Setting
    // #forceNextRender carries the invalidation across that race.
    this.onEffect<{ sig: string }>('swarm:resource-arrived', ({ sig }) => {
      if (sig) {
        for (const [label, cached] of this.#faces.images) {
          if (cached === sig || cached === null) {
            this.#faces.images.delete(label)
          }
        }
      }
      if (this.renderedLocationKey) {
        this.#layerCellsCache.delete(this.renderedLocationKey)
      }
      this.renderedCellsKey = ''
      this.#forceNextRender = true
      this.requestRender()
    })

    // substrate:rerolled — user rerolled a tile's substrate (single click or
    // bulk). The old in-place / incremental fast path here had the EXACT bug
    // tile:saved already learned from: it races concurrent synchronize
    // renders and leaves the tile showing the OLD image until a manual
    // refresh. Use the same robust recipe as tile:saved — drop the cached
    // derivation, evict the stale atlas slot, then run a locked full render
    // that re-reads the freshly-written propsSig from OPFS and paints the new
    // image immediately. Reroll is an explicit user gesture, and requestRender
    // coalesces a bulk burst into a single pass, so the full render is cheap.
    this.onEffect<{ cell: string }>('substrate:rerolled', (payload) => {
      if (payload?.cell) {
        const oldSig = this.#faces.images.get(payload.cell)
        this.#faces.images.delete(payload.cell)
        this.#faces.substrates.delete(payload.cell)
        if (oldSig && this.imageAtlas) this.imageAtlas.invalidate(oldSig)
      }
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // toggle tile label text visibility via shader uniform
    this.onEffect('tile:toggle-text', () => {
      this.#labelsVisible = !this.#labelsVisible
      this.shader?.setLabelMix(this.#labelsVisible ? 1.0 : 0.0)
    })

    // show hidden items grayed out when eye toggle is active
    this.onEffect<{ active: boolean }>('visibility:show-hidden', ({ active }) => {
      this.#showHiddenItems = active
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // World mode toggle from the command bar — dims unshared tiles (no filter).
    this.onEffect<{ active: boolean }>('world:mode', ({ active }) => {
      this.#worldMode = !!active
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // A tile's public/private flag flipped.
    this.onEffect('tile:public-changed', () => {
      // Re-publish the kind-29010 cell list so the flip propagates NOW. The
      // heartbeat key (locationKey:fsRev:grammar) doesn't move on a public
      // flip — public state is participant-local (localStorage), not the
      // signed layer — so without this nudge the mesh wouldn't republish
      // until the next navigation or periodic refresh. forceResnapshot posts
      // a fresh authoritative snapshot so the latest-snapshot-wins consumer
      // drops a now-private tile at once instead of unioning it for ~10 min.
      void this.#mesh.refresh('', true)
      // Render changes in world mode (the dim state of unshared tiles) AND
      // inside a swarm, where the flag decides MEMBERSHIP: the swarm-privacy
      // filter drops an unshared tile from the pass, so a flip either adds it
      // back or takes it away. Everywhere else the flag is invisible.
      if (!this.#worldMode && !(this.#publicMode && this.#mesh.credentialed)) return
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
    })

    this.onEffect<{ cell: string; index: number }>('cell:place-at', (payload) => {
      void this.#order.placeAt(payload.cell, payload.index)
    })

    this.onEffect<{ labels: string[] }>('cell:reorder', (payload) => {
      this.#order.reorder()
    })

    // Arrangement activation is presentation-first. Apply its sparse slot map
    // through the same zero-I/O mesh path as drag preview while the sequence
    // controller writes canonical indices in the background.
    this.onEffect<{ location: string; names: string[] | null }>('arrange:preview', (payload) => {
      if (!payload || typeof payload.location !== 'string') return
      if (payload.names) this.#arrangePreviewNames.set(payload.location, payload.names)
      else this.#arrangePreviewNames.delete(payload.location)
      if (payload.location !== this.#currentLocationKey()) return

      this.renderedCellsKey = ''
      if (payload.names && this.cachedCellNames) this.renderMovePreview()
      else this.requestRender()
    })

    // layout:mode and layout:swirl are legacy — the renderer now
    // operates only in pinned mode. Any incoming event is a no-op so
    // historical layers that still carry `mode: 'dense'` or a stray
    // /swirl command don't resurrect the spiral layout.

    this.onEffect<{ gapPx: number }>('render:set-gap', (payload) => {
      if (this.#hexGeo.gapPx !== payload.gapPx) {
        this.#hexGeo = createHexGeometry(this.#hexGeo.circumRadiusPx, payload.gapPx, this.#hexGeo.padPx)
        this.emitEffect('render:geometry-changed', this.#hexGeo)
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    // How tall the hovered tile's label band has to be, in rows. The OVERLAY
    // owns this because it does the icon wrapping; the shader only draws what
    // it is told, so a tile whose icons fit one row keeps the text's own band
    // height instead of growing for nothing.
    this.onEffect<{ rows?: number; label?: string | null }>('overlay:band-rows', (payload) => {
      const owner = typeof payload?.label === 'string' ? payload.label : null
      this.#bandRowsLabel = owner
      this.#bandRows = Math.max(1, payload?.rows ?? 1)

      // THE OVERLAY OWNS HOVER — it does the hit-testing and the wrapping, and
      // this message is it naming the tile whose menu is up and how tall that
      // menu is. Take the hovered tile from it, not just the height.
      //
      // The hovered index used to come from `tile:hover` ALONE, which the
      // overlay emits only when the hovered HEX CHANGES. Every other path that
      // re-lays the menu out — arriving on a new level, an icon registering, a
      // notes or decoration update — left the renderer holding the index a
      // geometry rebuild had already reset to -1. The shader draws the tall
      // band only for the hovered cell, so the icons stayed up on two rows over
      // a background that had snapped back to the resting one-row pill: the
      // rows collapsing, most visibly on the way into a tile.
      this.#applyHover(owner !== null && this.renderedCells.has(owner) ? owner : null)
    })

    // q/r and label are absent on the "nothing hovered" broadcast (pointer
    // over chrome), which clears the ring and reveal: chrome is not the hive.
    this.onEffect<{ q?: number; r?: number; label?: string | null; bandRows?: number }>('tile:hover', (payload) => {
      // The overlay already resolved the occupied tile. Prefer its
      // authoritative label: while geometry and occupancy are being replaced,
      // deriving it again from q/r can briefly miss and leave a hideText tile
      // visibly hovered with its name still hidden.
      const payloadLabel = typeof payload.label === 'string' ? payload.label : null
      let hoverLabel = payloadLabel && this.renderedCells.has(payloadLabel)
        ? payloadLabel
        : null

      // Compatibility for older emitters that only carry axial coordinates.
      if (!hoverLabel && payload.q !== undefined && payload.r !== undefined) {
        for (const [label, cell] of this.renderedCells) {
          if (cell.q === payload.q && cell.r === payload.r) { hoverLabel = label; break }
        }
      }

      // The band geometry and the hover target are one visual state. The hover
      // carries its own row count, so the background reaches its final height
      // in the same update the hover lands in — the label and icons never paint
      // into a one-row band that grows underneath them a frame later. Recorded
      // against the arriving label, so it cannot be read for any other tile.
      if (hoverLabel && payload.bandRows !== undefined) {
        this.#bandRowsLabel = hoverLabel
        this.#bandRows = Math.max(1, payload.bandRows)
      }

      // Same single path the band-rows message goes through, so the two can
      // never leave the reveal, the band height and the lit cell disagreeing.
      this.#applyHover(hoverLabel)
      if (!this.shader) return

      // Drive the shimmer clock only while a reference/portal tile is hovered,
      // so u_time (and the magical hover animation) idles the rest of the time.
      this.#setPortalShimmer(hoverLabel !== null && referenceTargetForLabel(hoverLabel) !== null)

      // Emit hovered tile's tags for UI highlight
      this.emitEffect('tile:hover-tags', { tags: hoverLabel ? this.#narrow.tagsFor(hoverLabel) : [] })
    })

    // accent color presets: glacier, bloom, aurora, ember, nebula
    const ACCENT_COLORS: [number, number, number][] = [
      [0.4, 0.85, 1.0],    // glacier — cyan
      [1.0, 0.4, 0.7],     // bloom — magenta-pink
      [0.2, 1.0, 0.6],     // aurora — green
      [1.0, 0.6, 0.15],    // ember — warm amber
      [0.65, 0.35, 1.0],   // nebula — violet
    ]

    // restore persisted accent color
    const stored = parseInt(localStorage.getItem('hc:neon-color') ?? '0', 10)
    if (stored >= 0 && stored < ACCENT_COLORS.length) {
      this.#accentColor = ACCENT_COLORS[stored]
    }
    if (this.shader) {
      const [r, g, b] = this.#accentColor
      this.shader.setAccentColor(r, g, b)
    }

    this.onEffect<{ index: number }>('overlay:neon-color', ({ index }) => {
      this.#accentColor = ACCENT_COLORS[index] ?? ACCENT_COLORS[0]
      if (!this.shader) return
      const [r, g, b] = this.#accentColor
      this.shader.setAccentColor(r, g, b)
    })

    ; (window as any).showCellsPoc = {
      publishCells: async (cells: string[]) => this.#mesh.publishList(cells),
      signature: async () => {
        const lineage = this.resolve<any>('lineage')
        return await this.computeSignatureLocation(lineage)
      }
    }
  }

  protected override dispose = (): void => {
    window.removeEventListener('synchronize', this.onSynchronize)
    window.removeEventListener('navigate', this.onNavigate)
    window.removeEventListener('hex-image-atlas:evicted', this.#onAtlasEvicted)
    window.removeEventListener('hex-image-atlas:retry', this.#onAtlasEvicted)
    window.removeEventListener('hex-label-atlas:evicted', this.#onLabelAtlasEvicted)
    window.removeEventListener('navigate', this.#onNavigateStarted)
    this.#readiness.dispose()
    this.#mesh.close()

    if (this.#flashTimer) { clearTimeout(this.#flashTimer); this.#flashTimer = null }
    if (this.#translationPulseTimer) { clearInterval(this.#translationPulseTimer); this.#translationPulseTimer = null }
    if (this.#markPreviewRaf) { cancelAnimationFrame(this.#markPreviewRaf); this.#markPreviewRaf = 0 }
    if (this.#substrateFadeRaf) { cancelAnimationFrame(this.#substrateFadeRaf); this.#substrateFadeRaf = 0 }
    if (this.#shadeFadeFrame !== null) { cancelAnimationFrame(this.#shadeFadeFrame); this.#shadeFadeFrame = null }
    if (this.#clusterRetryTimer) { clearTimeout(this.#clusterRetryTimer); this.#clusterRetryTimer = null }
    if (this.#readinessRepaintTimer) { clearTimeout(this.#readinessRepaintTimer); this.#readinessRepaintTimer = null }

    if (this.#newCellFadeRaf) {
      cancelAnimationFrame(this.#newCellFadeRaf)
      this.#newCellFadeRaf = 0
    }
    this.#newCellFadeStart.clear()

    this.#driftActive = false
    if (this.#driftRaf) {
      cancelAnimationFrame(this.#driftRaf)
      this.#driftRaf = 0
    }

    this.#portalShimmerActive = false
    if (this.#portalShimmerRaf) {
      cancelAnimationFrame(this.#portalShimmerRaf)
      this.#portalShimmerRaf = 0
    }

    if (this.lineageChangeListening) {
      const lineage = this.resolve<EventTarget>('lineage')
      lineage?.removeEventListener('change', this.onLineageChange)
      this.lineageChangeListening = false
    }

    if (this.#viewModeSource) {
      this.#viewModeSource.removeEventListener('change', this.#onViewModeChange)
      this.#viewModeSource = null
    }

    if (this.#missWindowTimer !== null) {
      clearTimeout(this.#missWindowTimer)
      this.#missWindowTimer = null
      this.#missWindowFireAt = 0
    }
  }

  // Re-open the completeness gates and force a repaint — shared by the
  // content:arrived effect and the miss-window timer. Drops the back-nav
  // cell caches of placeholder locations so the fast path can't restore a
  // stale placeholder set after the content heals.
  #rearmResolveGates = (): void => {
    this.#incompleteResolveAttempts.clear()
    this.#resolveGateExhausted.clear()
    for (const loc of this.#placeholderLocations) this.#layerCellsCache.delete(loc)
    this.#forceNextRender = true
    this.requestRender()
  }

  // Schedule ONE coalesced re-render shortly after the earliest miss-window
  // expiry among the given unresolved sigs. Reads the optional
  // ContentBrokerDrone.missUntil(sig) defensively — an absent broker or
  // method means no timer (content:arrived remains the re-arm). Bounded: a
  // timer is only armed from a placeholder paint, and each expiry fires
  // exactly one render pass; a still-incomplete pass re-arms for the NEXT
  // window, so the cadence follows the broker's own miss windows — never a
  // polling loop, never a retry storm.
  #armMissWindowRetry = (unresolvedSigs: readonly string[]): void => {
    let broker: { missUntil?: (sig: string) => number | undefined } | undefined
    try {
      broker = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')
    } catch { /* broker not registered — content:arrived remains the re-arm */ }
    if (typeof broker?.missUntil !== 'function') return
    const now = Date.now()
    let earliest = Infinity
    for (const sig of unresolvedSigs) {
      let until: number | undefined
      try { until = broker.missUntil(sig) } catch { continue }
      if (typeof until === 'number' && until > now && until < earliest) earliest = until
    }
    if (earliest === Infinity) return
    // Fire shortly AFTER the expiry so the window is genuinely open when
    // the re-render's reads reach the broker.
    const fireAt = earliest + 250
    // Coalesce onto a single timer: keep an already-armed EARLIER one (its
    // render pass re-arms for whatever is still missing); replace a later one.
    if (this.#missWindowTimer !== null && this.#missWindowFireAt <= fireAt) return
    if (this.#missWindowTimer !== null) clearTimeout(this.#missWindowTimer)
    this.#missWindowFireAt = fireAt
    this.#missWindowTimer = setTimeout(() => {
      this.#missWindowTimer = null
      this.#missWindowFireAt = 0
      this.#rearmResolveGates()
    }, Math.max(0, fireAt - Date.now()))
  }

  // Briefly glow a newly created tile so the user can spot it, then ease out
  // to normal. Reuses the existing #heatByLabel pathway consumed by the SDF
  // shader's heat ring.
  #startNewCellFade = (label: string): void => {
    this.#newCellFadeStart.set(label, performance.now())
    this.#heatByLabel.set(label, 1.0)
    // Don't force a full render — the incremental render kicked off by
    // cell:added will put the cell on screen; we just need to drive the heat
    // attribute each frame. If the cell isn't indexed yet this frame, the
    // next RAF will pick it up.
    this.#updateCellHeat(label, 1.0)
    if (this.#newCellFadeRaf) return

    const tick = (): void => {
      const now = performance.now()
      let alive = false
      for (const [cell, start] of this.#newCellFadeStart) {
        const elapsed = now - start
        if (elapsed >= ShowCellDrone.#NEW_CELL_FADE_MS) {
          this.#newCellFadeStart.delete(cell)
          this.#heatByLabel.delete(cell)
          this.#updateCellHeat(cell, 0)
          continue
        }
        const t = 1 - (elapsed / ShowCellDrone.#NEW_CELL_FADE_MS)
        const eased = t * t * t
        this.#heatByLabel.set(cell, eased)
        this.#updateCellHeat(cell, eased)
        alive = true
      }
      this.#newCellFadeRaf = alive ? requestAnimationFrame(tick) : 0
    }
    this.#newCellFadeRaf = requestAnimationFrame(tick)
  }

  /** Turn the launcher "cloud" drift on/off for the current page. When active,
   *  sets the shader's drift amplitude (a fraction of the hex radius) and runs a
   *  single rAF that advances u_time; the vertex shader does the rest. When
   *  inactive, zeroes the amplitude and stops the clock. Idempotent — safe to
   *  call on every render; the rAF is started once and reused. */
  #setDrift = (active: boolean, circumRadiusPx: number): void => {
    this.shader?.setDriftAmp(active ? circumRadiusPx * LAUNCHER_DRIFT_FRACTION : 0)
    if (active) {
      if (!this.#driftActive) { this.#driftActive = true; this.#driftStart = performance.now() }
      if (!this.#driftRaf) {
        const tick = (): void => {
          if (!this.#driftActive) { this.#driftRaf = 0; return }
          this.shader?.setTime((performance.now() - this.#driftStart) / 1000)
          this.#driftRaf = requestAnimationFrame(tick)
        }
        this.#driftRaf = requestAnimationFrame(tick)
      }
    } else {
      this.#driftActive = false
      if (this.#driftRaf) { cancelAnimationFrame(this.#driftRaf); this.#driftRaf = 0 }
    }
  }

  /** Start/stop the portal shimmer clock. A reference/portal tile's hover ring
   *  breathes and spins (fragment shader, keyed on u_time); u_time is otherwise
   *  frozen on a normal hive page, so we tick it only while a portal is hovered.
   *  No-op when launcher drift already owns the clock (u_time is live there).
   *  Idempotent. */
  #setPortalShimmer = (active: boolean): void => {
    if (active === this.#portalShimmerActive) return
    this.#portalShimmerActive = active
    if (active) {
      if (this.#driftActive) return                    // drift already advances u_time
      if (!this.#driftStart) this.#driftStart = performance.now()
      if (!this.#portalShimmerRaf) {
        const tick = (): void => {
          if (!this.#portalShimmerActive || this.#driftActive) { this.#portalShimmerRaf = 0; return }
          this.shader?.setTime((performance.now() - this.#driftStart) / 1000)
          this.#portalShimmerRaf = requestAnimationFrame(tick)
        }
        this.#portalShimmerRaf = requestAnimationFrame(tick)
      }
    } else {
      if (this.#portalShimmerRaf) { cancelAnimationFrame(this.#portalShimmerRaf); this.#portalShimmerRaf = 0 }
    }
  }

  /** Resolve the treatment's marks against this page and paint the answer.
   *
   *  TWO askers, one buffer, one ramp — a live hover outranks the standing
   *  armed bouquet, and each has its own matching rule:
   *    • hover (`tags:preview`): who carries ANY of these? — the carriers
   *      light, the rest recede;
   *    • armed (`tags:apply-pending`): who already wears ALL of it? — those
   *      stay lit as settled ground, and everything still missing part of the
   *      set recedes: exactly the tiles a click will scent.
   *  While armed, the treatment stays ON even with zero matches — a fully
   *  receded page IS the honest answer ("nothing wears this yet; click tiles
   *  to scent them"), where the hover with no carriers just stays dark.
   *
   *  The carrier set goes STRAIGHT into the divergence buffer and is pushed to
   *  the GPU — a hover must never cost a render pass, and nothing here belongs
   *  in one: no geometry moves and no cell record changes. The flag value (3)
   *  is deliberately outside the divergence vocabulary (0/1/2), so a rebuild
   *  bakes the tile's REAL divergence and the treatment simply repaints itself
   *  over the fresh buffer (see #markPreviewGeom). */
  #refreshMarkPreview(): void {
    const dragged = this.#dragShadeMarks
    const hovered = this.#markPreviewMarks
    const armed = this.#armedApplyMarks
    // The live drag outranks the hover, the hover outranks the standing armed
    // set. Drag and armed share the ALL-match rule (what would the landing
    // change?); the hover keeps ANY-match (who carries this?).
    const all = dragged.length > 0 ? dragged : (hovered.length > 0 ? null : armed)
    const next = new Set<string>()
    if (all === null) {
      const marks = new Set(hovered)
      for (const label of this.renderedCells.keys()) {
        for (const t of this.#narrow.tagsFor(label)) if (marks.has(t)) { next.add(label); break }
      }
    } else if (all.length > 0) {
      for (const label of this.renderedCells.keys()) {
        const worn = this.#narrow.tagsFor(label)
        if (all.every(t => worn.includes(t))) next.add(label)
      }
      const tint = dragged.length > 0 ? this.#dragShadeColor : this.#armedApplyColor
      if (tint) this.#markPreviewColor = tint
    }
    this.#markPreviewLabels = next
    const active = all === null ? next.size > 0 : all.length > 0
    if (active) this.#paintMarkPreviewBuffer()
    this.#setMarkPreview(active)
  }

  /** Write the carrier flag for every cell in the current buffer. Non-carriers
   *  are restored to their BAKED divergence (from the cell record), which is
   *  what makes moving from one mark to the next a single push rather than a
   *  clear-then-paint. */
  #paintMarkPreviewBuffer(): void {
    if (!this.#buf.divergence || !this.geom) return
    for (const [label, i] of this.#labelToIndex) {
      const baked = this.renderedCells.get(label)?.divergence ?? 0
      this.#writeCellScalar(this.#buf.divergence, i, this.#markPreviewLabels.has(label) ? 3 : baked)
    }
    this.#pushBuffer('aDivergence')
    this.#markPreviewGeom = this.geom
  }

  /** Put every cell back to its baked divergence. Runs at the END of the fade
   *  out, not at the moment the cursor leaves: u_markPreview is already ramping
   *  to 0, so restoring the flags early would snap the lit tiles dark while the
   *  rest of the page was still fading back. */
  #restoreMarkPreviewBuffer(): void {
    this.#markPreviewGeom = null
    if (!this.#buf.divergence || !this.geom) return
    for (const [label, i] of this.#labelToIndex) {
      this.#writeCellScalar(this.#buf.divergence, i, this.renderedCells.get(label)?.divergence ?? 0)
    }
    this.#pushBuffer('aDivergence')
  }

  /** Ramp the preview in or out. The rAF runs for as long as the treatment is
   *  showing — it owns three things at once: the 0..1 strength ramp, the breath
   *  clock (u_time, frozen on a normal hive page), and re-pushing the uniforms
   *  after a shader swap, which is why it reads `this.shader` every frame
   *  instead of capturing it. */
  #setMarkPreview = (active: boolean): void => {
    this.#markPreviewTarget = active ? 1 : 0
    if (!this.#markPreviewRaf) this.#markPreviewRaf = requestAnimationFrame(this.#markPreviewTick)
  }

  #markPreviewTick = (): void => {
    const target = this.#markPreviewTarget
    const step = 0.11                                   // ≈ 150ms edge to edge
    const k = target > this.#markPreviewK
      ? Math.min(target, this.#markPreviewK + step)
      : Math.max(target, this.#markPreviewK - step)
    this.#markPreviewK = k
    const shader = this.shader
    shader?.setMarkPreview(k)
    if (k > 0) {
      shader?.setMarkColor(this.#markPreviewColor[0], this.#markPreviewColor[1], this.#markPreviewColor[2])
      // The breath needs a clock. u_time is frozen on an ordinary hive page and
      // shared with launcher drift, which owns it whenever it is running.
      if (!this.#driftActive) {
        if (!this.#driftStart) this.#driftStart = performance.now()
        shader?.setTime((performance.now() - this.#driftStart) / 1000)
      }
      // A repaint or a navigation replaced the buffer under us — paint again.
      if (this.geom !== this.#markPreviewGeom) this.#refreshMarkPreview()
    }
    if (k === 0 && target === 0) {
      this.#markPreviewRaf = 0
      this.#restoreMarkPreviewBuffer()
      return
    }
    this.#markPreviewRaf = requestAnimationFrame(this.#markPreviewTick)
  }

  // settledEmpty: TRUE only when the caller has confirmed the render pipeline
  // was READY (pixi + axial + lineage up) and the location genuinely resolved
  // to zero tiles — i.e. this is a real "empty layer", not a "not ready yet"
  // bail. It rides out on the render:cell-count payload so the loading splash
  // can tell the two apart: a settled empty layer means the hive is ready to
  // reveal (there are simply no tiles), whereas a not-ready count:0 (pixi still
  // warming) must be ignored so a populated hive never flashes blank before its
  // tiles paint. Default false — an unclassified clear is treated as not-ready.
  private clearMesh = (reason: string, settledEmpty = false): void => {
    const retainWarmMesh = settledEmpty && !!this.hexMesh && !!this.geom && !!this.layer
    if (this.hexMesh && this.layer) {
      // A live-mesh teardown must NEVER be silent. Every "tiles rendered
      // and then vanished" bug funnels through here, and an unexplained
      // clear is indistinguishable from a legitimate empty-layer render.
      // The reason names the bail site so a vanish in the field is
      // diagnosable straight from the console.
      console.warn(`[render] clearMesh: clearing ${this.renderedCount} rendered cell(s) — ${reason}`)
      // Capture the centering offset before destroying the mesh so the
      // next mesh (e.g. when redo brings tiles back from empty) can
      // restore it instead of starting at (0,0).
      this.#lastMeshOffset = { x: this.hexMesh.position.x, y: this.hexMesh.position.y }
      if (retainWarmMesh) {
        this.hexMesh.visible = false
      } else {
        try { this.layer.removeChild(this.hexMesh as any) } catch { /* ignore */ }
        try { this.hexMesh.destroy?.(true) } catch { /* ignore */ }
      }
    }

    if (this.geom && !retainWarmMesh) {
      try { this.geom.destroy(true) } catch { /* ignore */ }
    }

    // No mesh on screen → no launcher page to drift, no portal to shimmer.
    this.#setDrift(false, 0)
    this.#setPortalShimmer(false)

    if (!retainWarmMesh) {
      this.hexMesh = null
      this.geom = null
    }
    this.renderedCellsKey = ''
    // No buffer left, so no generation has been applied to one.
    this.#bakedImageAtlasGen = -1
    this.#bakedLabelAtlasGen = -1
    this.renderedCount = 0
    this.renderedCells.clear()
    this.cachedCellNames = null
    this.cachedLocalCellSet = null
    this.cachedBranchSet = null
    // Clear any pending position-restore flags. The mesh is gone; whoever
    // creates the next one is responsible for setting fresh values. Without
    // this, a layer that bailed via clearMesh (empty branch) used to leak
    // pendingRecenter=true into the NEXT layer change, which then ignored
    // the saved meshOffset and recentered → tiles + overlay misaligned.
    this.#pendingRecenter = false
    this.#pendingMeshOffsetRestore = null
    // The pointer is not on any tile of a mesh that no longer exists. Left
    // set, a same-named tile on the NEXT layer would bake in revealed — and
    // would inherit its band height with it, so drop the row count's owner on
    // the same breath. The arriving level's own layout re-establishes both.
    this.#hoverRevealLabel = null
    this.#bandRowsLabel = null
    this.emitEffect('render:cell-count', { ...this.#buildCellCountPayload([]), settled: settledEmpty })
  }

  /**
   * Attach the i18n label resolver to the label atlas so cell directory names
   * are rendered as localized display text when a translation is registered.
   */
  /** The address→display seam. A cell's directory name is its ADDRESS, and
   *  what gets BAKED is that address READ IN THE CURRENT LOCALE: this tile's
   *  own title for the locale, else the shared i18n resolution (`cell.<name>`
   *  overrides + catalogs), else the address itself. Ordering the tile's own
   *  title first is what makes a rename a decoration rather than a re-address
   *  (see decoration-kind-index's title sub-index).
   *
   *  `locale` is read per call, not captured: `locale:changed` flushes the
   *  atlas and every label re-resolves through here, so a language switch
   *  swaps titles with no extra wiring. */
  private readonly attachLabelResolver = (atlas: HexLabelAtlas): void => {
    atlas.setLabelResolver(this.displayNameFor)
  }

  /** The one address→display resolution, shared by the SDF bake and the DOM
   *  name layer (tile-name.drone.ts) so a tile can never read two ways. */
  public readonly displayNameFor = (directoryName: string): string => {
    const i18n = get<I18nProvider>(I18N_IOC_KEY)
    const locale = i18n?.locale ?? 'en'
    return this.registryTitlesByLabel.get(directoryName)?.[locale]?.trim()
      || titleForLabel(directoryName, locale)
      || (i18n ? i18n.resolveCell(directoryName) : directoryName)
  }

  /**
   * Pay the one-time SDF raster + WebGL pipeline compilation while the window
   * is still initializing, never on the participant's first add. Chromium's
   * first HexLabelAtlas.getLabelUV measured 630–730ms even for one short
   * label; every later label was <1ms. A one-cell offscreen draw also compiles
   * the exact tile shader/program so empty → first-item can reach the next
   * painted frame instead of stalling on driver work.
   */
  #primeEmptyRenderPipeline = (): void => {
    if (!this.pixiRenderer || !this.atlas || !this.imageAtlas) return
    let geom: Geometry | null = null
    let mesh: Mesh | null = null
    let retained = false
    try {
      const primeLabel = PENDING_CELL_LABEL
      this.atlas.seed([primeLabel])
      const { circumRadiusPx, gapPx, padPx } = this.#hexGeo
      const pointReachPx = circumRadiusPx / 0.8660254
      const halfW = (this.#flat ? pointReachPx : circumRadiusPx) + padPx
      const halfH = (this.#flat ? circumRadiusPx : pointReachPx) + padPx
      geom = this.buildFillQuadGeometry(
        [{ q: 0, r: 0, label: primeLabel, external: false, plain: true }],
        circumRadiusPx,
        gapPx,
        halfW,
        halfH,
      )
      const warmShader = new HexSdfTextureShader(
        this.atlas.getAtlasTexture(),
        this.imageAtlas.getAtlasTexture(),
        halfW * 2,
        halfH * 2,
        circumRadiusPx,
      )
      warmShader.setFlat(this.#flat)
      warmShader.setPivot(this.#pivot)
      mesh = new Mesh({
        geometry: geom as any,
        shader: (warmShader as any).shader,
        texture: Texture.WHITE as any,
      } as any)
      ;(mesh as any).blendMode = 'pre-multiply'
      // Compile against the application's real framebuffer. An offscreen
      // target — or geometry clipped outside the viewport — left SwiftShader's
      // first fragment draw costing 100–240ms. Draw the one-cell prime while
      // boot chrome still covers the canvas, remove it in the same task, then
      // clear immediately: no participant-visible frame contains the prime.
      this.layer?.addChild(mesh as any)
      if (this.pixiApp) this.pixiRenderer.render({ container: this.pixiApp.stage })
      mesh.visible = false
      if (this.pixiApp) this.pixiRenderer.render({ container: this.pixiApp.stage })
      this.hexMesh = mesh
      this.geom = geom
      this.shader = warmShader
      retained = true
    } catch (err) {
      console.warn('[show-cell] render pipeline prime failed', err)
    } finally {
      if (!retained) {
        try { (mesh as any)?.destroy?.(true) } catch { /* best effort */ }
        try { geom?.destroy(true) } catch { /* mesh may already own it */ }
      }
      // buildFillQuadGeometry populates the live update indexes. The priming
      // cell is never part of the visible projection, so discard those refs.
      this.#buf = {}
      this.#labelToIndex.clear()
      this.#shadedLabels.clear()
      this.#wandTakingLabels.clear()
      // No buffer to ramp into any more; a fade that outlived its geometry
      // would write into the next page's indexes.
      this.#shadeFadeStartedAt.clear()
    }
  }

  private readonly rebuildRenderResources = (renderer: unknown): void => {
    this.clearMesh("rebuildRenderResources: context restore")
    this.shader = null
    this.atlas = new HexLabelAtlas(renderer, 128, 16, 16) // 256 slots (match imageAtlas) so >64-tile hives don't wrap & thrash the render cache
    this.attachLabelResolver(this.atlas)
    this.imageAtlas = new HexImageAtlas(renderer, 256, 16, 16)
    this.#primeEmptyRenderPipeline()
    this.#faces.images.clear()
    this.atlasRenderer = renderer
  }

  // Per-revision cache. Multiple callers per nav ask for the same dir's
  // children; the OPFS scan is the same answer until lineage's #fsRevision
  // listCellFolders retired: tile membership is read exclusively from
  // the current layer's children slot via history.currentLayerAt +
  // history.getLayerBySig. The OPFS hierarchy at hypercomb.io/<tile>/
  // is no longer the source of truth for tile lists.

  // Single source of truth for the render:cell-count payload. Listeners
  // (TileSelectionDrone, TileOverlayDrone, etc.) read coords[i],
  // branchLabels, externalLabels, etc. — emitting a stripped payload
  // makes them store undefined and throw on the next access. Keep every
  // emit going through this helper so back-nav fast path, tag-flatten,
  // streaming, and incremental paths all send identical shapes.
  /** Set on every `navigate`; cleared by the first pass that paints tiles. */
  #navStartedAt = 0
  /** Monotonic render ownership token carried by tiles-target and cell-count. */
  #tileRenderPassId = 0

  #buildCellCountPayload(cells: readonly Cell[]): {
    locationKey: string
    renderPassId: number
    count: number
    labels: string[]
    coords: { q: number; r: number }[]
    branchLabels: string[]
    externalLabels: string[]
    swarmTakeLabels: string[]
    noImageLabels: string[]
    substrateLabels: string[]
    linkLabels: string[]
    hiddenLabels: string[]
    shadedLabels: string[]
    flatPaths: Record<string, string[]>
    filterBlocked: string[]
  } {
    // Empty-layer invitation watermark — DISABLED for now. It should be a
    // genuine-swarm cue, but public mode is the default in some shells, so
    // it fired on every empty location and read as a default background
    // rather than a swarm thing. Wiring stays (the app shells still listen
    // for `swarm:empty-layer`); we emit `false` so the watermark never
    // shows until it's re-gated on a real swarm session (room + secret +
    // peers present) instead of just public mode.
    this.emitEffect('swarm:empty-layer', { active: false })

    // The navigation's own number: click → tiles on screen, and how many of
    // those tiles still owe the atlas an image at that moment (a high count
    // means the paint landed but the page keeps filling in after it).
    if (this.#navStartedAt && cells.length > 0) {
      const ms = Math.round(performance.now() - this.#navStartedAt)
      this.#navStartedAt = 0
      const atlas = this.imageAtlas
      const pending = atlas
        ? cells.filter(c => c.imageSig && !atlas.hasImage(c.imageSig) && !atlas.hasFailed(c.imageSig)).length
        : 0
      console.log(`[nav] ${cells.length} tiles in ${ms}ms (${pending} image(s) still loading)`)
    }

    // Peer tiles get marked as branches so tile-overlay routes their
    // clicks through #navigateInto (URL changes, lineage updates, swarm
    // re-subscribes). Without this they fall through to the editor's
    // 'open' action and the user can't browse a peer's tree.
    return {
      locationKey: this.renderedLocationKey || '/',
      renderPassId: this.#tileRenderPassId,
      count: cells.length,
      labels: cells.map(c => c.label),
      coords: cells.map(c => ({ q: c.q, r: c.r })),
      // In public/swarm mode EVERY tile is a branch: you can navigate into
      // any tile to explore — even one with no children yet — which is how
      // you enter an empty space and invite others in. In private mode only
      // tiles that already have children (or live peer tiles) drill in;
      // everything else opens the editor on click.
      branchLabels: this.#publicMode
        ? cells.map(c => c.label)
        : cells.filter(c => c.hasBranch || this.#peerCellSet.has(c.label)).map(c => c.label),
      externalLabels: cells.filter(c => c.external).map(c => c.label),
      // FIRST CLICK ADOPTS, SECOND CLICK ENTERS (Jaime, 2026-08-20): the
      // tiles whose next click is a TAKE rather than a walk — external and
      // still receding. Computed hover-free by construction, because the
      // click always arrives hovering and the live #cellIsShaded lifts the
      // hovered tile, which would deny the take exactly when it matters. A
      // stack variant is YOUR tile seen through a peer's layer, and a
      // wand-touched tile is already being added — both enter on click.
      swarmTakeLabels: cells
        .filter(c => c.external
          && !this.#stackVariantLabels.has(c.label)
          && !this.#wandTakingLabels.has(c.label))
        .map(c => c.label),
      // Peer / external tiles are NEVER substrate-fillable blanks: their
      // image is the PUBLISHER's (it just may not have streamed locally yet),
      // and painting the receiver's random pool pick on a tile they don't own
      // is wrong (same invariant loadOne enforces). Crucially, this also stops
      // the adopt-wipes-image bug: a witnessed peer tile whose bytes hadn't
      // arrived was reported blank → SubstrateDrone wrote a random pick into
      // index[cellLocationSig(here, name)] → on adopt that random image won
      // over the publisher's real one ("autogenerated background on adopt").
      // `pendingProps` is excluded for the same reason: the tile's props blob
      // hasn't landed locally yet, so "no imageSig" is UNKNOWN, not blank. A
      // default assigned during that window goes into the local props index,
      // which is what the render resolves through — it then outranks the tile's
      // real image on every later pass, and only an editor re-save dislodges it.
      // A concluded miss clears pendingProps (see loadOne), so a tile whose
      // bytes never arrive still becomes substrate-fillable.
      noImageLabels: cells
        .filter(c => !c.imageSig && !c.external && !this.#peerCellSet.has(c.label) && !c.plain && !c.pendingProps)
        .map(c => c.label),
      substrateLabels: cells.filter(c => c.hasSubstrate).map(c => c.label),
      linkLabels: cells.filter(c => c.hasLink).map(c => c.label),
      hiddenLabels: [...new Set([...(this.#showHiddenItems ? this.#currentHiddenSet : []), ...this.#dormantLaunchLabels])],
      // READINESS IS INFORMATION, NOT PERMISSION. A dim branch is still
      // preparing its next view — entering it is allowed and simply makes the
      // participant wait (TileOverlayDrone diverts the preloader at the tile
      // being entered instead of refusing the press). Hover may lift opacity,
      // but #cellIsPreloading ignores hover, so appearance never counterfeits
      // the honest answer to "has this arrived yet".
      shadedLabels: cells.filter(c => this.#cellIsPreloading(c)).map(c => c.label),
      // Tag-flatten only — hence the narrowing's own guard: several render paths
      // reach this helper without passing the flatten block, and a stale entry
      // surviving into an ordinary page would redirect (or refuse) a click on
      // an unrelated tile that merely shares a name with a past match.
      ...this.#narrow.entry(),
    }
  }

  /**
   * A cell:added whose location is exactly one level BELOW the current
   * screen flips its parent tile — visible here — from leaf to branch.
   * Mark the slot machine and queue an (empty) incremental flush: the
   * coalesced re-run rebuilds the cells from the marked snapshot, repaints
   * the branch dot, refreshes the #layerCellsCache entry, and re-emits
   * render:cell-count so tile-overlay's #branchLabels admits the click.
   * Purely in-memory — no OPFS, so it cannot race the commit.
   */
  #flipParentBranchFor(childSegments: readonly string[]): void {
    if (childSegments.length === 0 || !this.#slots.seeded) return
    if (!this.#segmentsAreCurrent(childSegments.slice(0, -1))) return
    const parent = String(childSegments[childSegments.length - 1] ?? '')
    if (!parent || !this.#slots.has(parent) || this.#slots.hasBranch(parent)) return
    this.#slots.markBranch(parent)
    this.#queueIncremental({})
  }

  /**
   * True when `segments` names the location currently rendered. Used to
   * filter cell:added events so a nested create (which fires one event per
   * affected ancestor location) only mounts the tile that belongs here.
   */
  #segmentsAreCurrent(segments: readonly string[]): boolean {
    const lineage = this.resolve<any>('lineage')
    const current: readonly string[] = lineage?.explorerSegments?.() ?? []
    if (segments.length !== current.length) return false
    for (let i = 0; i < segments.length; i++) {
      if (String(segments[i]) !== String(current[i])) return false
    }
    return true
  }

  private checkCellHasBranch = async (parentDir: FileSystemDirectoryHandle, cellName: string): Promise<boolean> => {
    try {
      const cellDir = await parentDir.getDirectoryHandle(cellName, { create: false })
      for await (const [name, handle] of cellDir.entries()) {
        // A branch is a NAMED child dir. Skip legacy underscore sidecars and
        // sig-named dirs (64-hex: a sign(meaning) pool or a lineage sigbag)
        // so a flat-root sibling never registers as a false branch.
        if (handle.kind === 'directory' && !name.startsWith('__') && !/^[0-9a-f]{64}$/.test(name)) return true
      }
    } catch { /* cell doesn't exist or can't be read */ }
    return false
  }

  // Rebuild #presenceGlowByLabel from the swarm's interest snapshot at the
  // current sig. Each child name maps to the set of OTHER peers currently
  // inside / entering it; we turn that count into a 0..1 glow that ramps
  // with crowd size and saturates — one visitor is a clear cue, more
  // people glow brighter. Cheap map walk; no network. Empty (and a fast
  // exit) in private mode or when the swarm bee isn't loaded.
  #refreshPresenceGlow = (): void => {
    this.#presenceGlowByLabel.clear()
    if (!this.#publicMode) return
    try {
      const swarm = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') as
        | { presenceGlowSnapshot?: () => ReadonlyMap<string, number> }
        | undefined
      const snapshot = swarm?.presenceGlowSnapshot?.()
      if (!snapshot || snapshot.size === 0) return
      for (const [name, count] of snapshot) {
        if (count <= 0) continue
        // 0.5 floor so a single explorer is plainly visible; +0.16 per
        // extra head, saturating at full intensity for a crowd.
        const glow = Math.min(1, 0.5 + (count - 1) * 0.16)
        this.#presenceGlowByLabel.set(name, glow)
      }
    } catch { /* swarm not ready — no glow */ }
  }

  /** Cluster-island coordinates for an ORDERED launcher page (help), or null to
   *  fall through to the normal spiral. Engages only once at least one cell
   *  carries the `header` role — so /games, /websites and every hive page keep
   *  the spiral untouched. Keyed by LABEL (islands are placed by identity, not
   *  index). Also returns the header labels for the title-tile border tint. */
  #launcherClusterCoords = (names: string[]): { coords: Map<string, { q: number; r: number }>; headers: Set<string> } | null => {
    const segs = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')?.explorerSegments?.() ?? []
    if (!isLauncherLocation(segs)) return null

    // The island id + header role live on each tile's `launch:target` decoration.
    const groupOf = launchGroupForLabel
    const roleOf = launchRoleForLabel

    // Gather each island by its GROUP id (carried per tile in the decoration),
    // NOT by render order — a slot system re-sorts `names`, so a position-delimited
    // walk would scatter an island's tiles across the field. Each island's header
    // is its role:'header' tile; islands order by the id's trailing digits.
    const headers = new Set<string>()
    const byGroup = new Map<string, { header: string | null; actions: string[]; ord: number }>()
    for (const label of names) {
      if (!label) continue
      const g = groupOf(label)
      if (!g) continue
      let bucket = byGroup.get(g)
      if (!bucket) { bucket = { header: null, actions: [], ord: parseInt(g.replace(/\D/g, ''), 10) || 0 }; byGroup.set(g, bucket) }
      if (roleOf(label) === 'header') { bucket.header = label; headers.add(label) }
      else bucket.actions.push(label)
    }
    // Nothing grouped yet (cold hydration) or a non-clustered launcher page
    // (games/websites): keep the spiral. A late-hydrating group normally
    // re-renders via the `launch:indexed` nudge, but every event path to that
    // nudge can be swallowed on boot (a stream pass hydrates the index with
    // nudge=false, consumes the walk memo, then LOSES the supersede race — the
    // winning pass paints cold and no walk ever re-fires). So a cold cluster
    // paint also arms the bounded index re-check below.
    if (byGroup.size === 0) {
      this.#armClusterRetry(names, groupOf)
      return null
    }
    const groups: ClusterGroup[] = [...byGroup.values()].sort((a, b) => a.ord - b.ord)
    return { coords: launcherClusterLayout(groups), headers }
  }

  /** Bounded self-heal for a clustered page painted before its island groups
   *  hydrated: re-check the group index shortly after the cold paint and
   *  rebuild geometry once it warms. Three checks with backoff, then give up —
   *  genuinely non-clustered launcher pages (games, websites) stay cold by
   *  design and cost only a map lookup per check. */
  #clusterRetryTimer: ReturnType<typeof setTimeout> | null = null
  #armClusterRetry = (names: string[], groupOf: (label: string) => string, attempt = 0): void => {
    if (this.#clusterRetryTimer || attempt > 2) return
    this.#clusterRetryTimer = setTimeout(() => {
      this.#clusterRetryTimer = null
      if (names.some(l => l && groupOf(l))) {
        this.renderedCellsKey = ''
        this.requestRender()
        return
      }
      this.#armClusterRetry(names, groupOf, attempt + 1)
    }, 500 * Math.pow(3, attempt))
  }

  /** Readiness shade — DIM IS THE DEFAULT, BRIGHT IS EARNED. A cell renders
   *  bright only on positive proof of readiness: its image bytes are on
   *  screen, or its resolution CONCLUDED (label-only by design, decode
   *  failure, or a host fill that concluded empty — the terminal states).
   *  Everything else — derivation in flight, bytes in flight, or a label
   *  never resolved at all — shades, so an unknown state can never
   *  masquerade as clickable. Shaded cells render dimmed (aShaded) and are
   *  inert (TileOverlayDrone mirrors the set); they brighten IN PLACE when
   *  their proof lands. The terminal releases are load-bearing: without
   *  them, unreachable bytes would strand a tile dimmed/inert forever. */
  /** True once this cell's OWN image/props have settled — present on screen,
   *  decode-failed, or concluded-missing. The original readiness predicate,
   *  extracted so the branch gate can require BOTH own-settled and
   *  children-ready. */
  #ownImageSettled(c: Cell): boolean {
    if (c.pendingProps) return false
    if (c.imageSig) {
      if (this.imageAtlas?.hasImage(c.imageSig)) return true
      if (this.imageAtlas?.hasFailed(c.imageSig)) return true
      return this.#fillMissedSigs.has(c.imageSig)
    }
    return this.#faces.images.has(c.label)
  }

  #cellIsPreloading(c: Cell): boolean {
    // Plain launcher cells do not navigate into a preloaded child view.
    if (!this.imageAtlas || c.plain) return false
    // The membership is already real to the participant, but its durable
    // commit is still draining. Keep the tile visible and plainly pending;
    // never let an old bright-label proof make it look fully settled.
    if (this.#pendingCellMutations.has(c.label)) return true
    // This is arrival truth, independent of TILE_SHADE and hover. The
    // presentation may lift opacity under the pointer; that changes how the
    // tile LOOKS, never what has actually landed.
    // Stable per location visit: late branch/props churn does not dim a proven
    // tile. Exact atlas eviction explicitly removes the proof and bright bit.
    // A tile may first paint as a leaf while its branch-status is still being
    // resolved. Leaf brightness proves only its OWN image. If it later gains
    // a branch dot, that weaker proof must not bypass children readiness.
    if (
      this.#readiness.isBright(c.label)
      && (!CHILD_SHADE || !c.hasBranch || this.#readiness.isReady(c.label))
    ) return false
    // BRANCH (opt-in, see CHILD_SHADE): shaded until its OWN image settles
    // AND the tiles INSIDE it (its direct children) all have their images
    // present-or-concluded — an un-shaded branch means "click me, the inside
    // is already loaded, the click lands with ZERO latency". LEAF (and every
    // tile while the flag is off): just its own image. Burden of proof is on
    // readiness; each release is recorded so the gate only ever opens on
    // proof. Brightness now means proven, full stop.
    const own = this.#ownImageSettled(c)
    const ready = (CHILD_SHADE && c.hasBranch)
      ? own && this.#readiness.isReady(c.label)
      : own
    if (ready) {
      this.#readiness.markBright(c.label)
    }
    return !ready
  }

  #cellIsShaded(c: Cell): boolean {
    // Shade off and hover affect presentation only. Neither can weaken the
    // independent readiness predicate the payload publishes.
    if (!TILE_SHADE || this.#hoverOpaqueLabel === c.label) return false
    // THE SWARM'S SHADE — A STANDING STATE, NOT A MODIFIER PREVIEW (Jaime,
    // 2026-08-20: "when you go into a swarm there should be tiles shaded").
    // In a zone, every tile you don't own yet recedes, from the moment you
    // arrive: the page itself says which tiles are somebody else's and which
    // ones you have added. A tile a take has touched lifts out (it is
    // becoming yours) and stays out — the fold that follows paints it
    // native, permanently and at full brightness. The hover clause above
    // keeps the one under the pointer bright, which reads as "this is the
    // one you'd add". Presentation only — the fold, the guards, and
    // ownership never consult this.
    // A SPOTLIT PEER'S VERSION OF YOUR OWN TILE is not "somebody else's
    // tile": under superimposition it is the SAME tile seen through their
    // layer, and you hold it. It rides the external path for the BYTES
    // (their streamed image), which must not read as "you don't have this".
    if (c.external
      && !this.#stackVariantLabels.has(c.label)
      && !this.#wandTakingLabels.has(c.label)) return true
    // A HELD tile a peer is offering something for — "this needs an update" —
    // recedes exactly like a tile you haven't adopted (Jaime, 2026-08-20:
    // "things are grayed out when they're not adopted or they need updates").
    // One shade, one meaning: dim = a click will ACQUIRE here, bright = a
    // click will enter. The wand's touch lifts it the moment the update is
    // taken, same as a take.
    if (!c.external
      && !this.#wandTakingLabels.has(c.label)
      && peerDivergesAt(c.label)) return true
    return this.#cellIsPreloading(c)
  }

  #preloadingLabels(): string[] {
    return [...this.renderedCells.values()]
      .filter(c => this.#cellIsPreloading(c))
      .map(c => c.label)
  }

  /** Diagnostic: which tiles on this page are dim right now, split by WHY —
   *  `swarm` (somebody else's, not yours yet) or `readiness` (yours, still
   *  loading). Reads the live predicates the geometry write consults, so a
   *  "the shade isn't showing" report names its half instead of guessing.
   *  Nothing in the app reads this; the swarm harness does. */
  public shadeDebug = (): { swarm: string[]; diverged: string[]; readiness: string[] } => {
    const cells = [...this.renderedCells.values()]
    return {
      swarm: cells.filter(c => c.external && this.#cellIsShaded(c)).map(c => c.label),
      diverged: cells.filter(c => !c.external && this.#cellIsShaded(c) && peerDivergesAt(c.label)).map(c => c.label),
      readiness: cells.filter(c => !c.external && this.#cellIsShaded(c) && !peerDivergesAt(c.label)).map(c => c.label),
    }
  }

  private buildCellsFromAxial = (axial: any, names: string[], max: number, localCellSet: Set<string>, branchSet?: Set<string>): Cell[] => {
    const out: Cell[] = []
    // A preview — a move drag, or an arrangement being activated — is a SPARSE
    // slot array: the index IS the grid slot and an empty string is a slot
    // deliberately left free. While one is up it is AUTHORITATIVE for every
    // slot: a missing entry means EMPTY, never "fall back to where that tile
    // used to sit". The old per-slot fallback drew a tile at its new slot AND
    // its old one whenever the new arrangement packed tighter than the
    // committed one — the arrangement doubling up and leaving the previous
    // shape behind. Symmetrically, walking only to the COMMITTED length cut
    // every tile the new arrangement had placed past it. So the walk is sized
    // by whichever array is authoritative, bounded by the grid.
    const preview = this.#effectivePreviewNames() ?? this.#railRanks(names)
    const effectiveNames = preview ?? names
    const gridMax = typeof axial?.items?.size === 'number' ? axial.items.size : effectiveNames.length
    // A preview array is grid-length (move) or highest-slot-length (arrange);
    // either way only the slots up to its LAST occupant can produce a tile, so
    // the walk stops there rather than at the raw length.
    let previewEnd = 0
    if (preview) {
      for (let i = preview.length - 1; i >= 0; i--) {
        if (preview[i]) { previewEnd = i + 1; break }
      }
    }
    const walk = Math.min(Math.max(max, previewEnd), gridMax)
    // Clustered-island layout for the ordered help page — placed by label, so
    // grouping reads the committed `names` order (a transient move-drag never
    // rescrambles the islands). Null on every other page ⇒ the spiral below.
    const cluster = this.#launcherClusterCoords(names)

    // World mode: tiles that aren't public render dimmed. Resolve the location
    // once; isCellPublic() is branch-aware (own flag or any ancestor branch).
    const worldMode = this.#worldMode
    const worldLocation = worldMode ? String(this.resolve<any>('lineage')?.explorerLabel?.() ?? '/') : ''
    // Current path once per pass — the collection-rim predicates key on it.
    const collectionSegs = ((this.resolve<any>('lineage')?.explorerSegments?.() ?? []) as unknown[])
      .map(s => String(s ?? '').trim()).filter(Boolean)

    // Stage diagnosis: any occupied slot at or past `max` is CUT from this
    // render entirely — those tiles only appear when a later pass renders
    // with a bigger axial map. This is the "second stage" of a two-stage
    // load: a score-filled tile placed past the axial size waits here.
    const beyondMax = effectiveNames.slice(walk).map((l, off) => l ? `${l}@${walk + off}` : '').filter(Boolean)
    if (beyondMax.length) console.info(`[layout] axial-truncated (slots ≥ ${walk}):`, beyondMax.join(', '))

    for (let i = 0; i < walk; i++) {
      const label = preview ? (preview[i] ?? '') : names[i]
      // On a clustered launcher page the tile sits at its island coordinate
      // (resolved by label); everywhere else it takes the axial spiral slot i.
      const override = cluster?.coords.get(label)
      const a = override ?? (axial.items.get(i) as Axial | undefined)
      if (!a) {
        const dropped = effectiveNames.slice(i).map((l, off) => l ? `${l}@${i + off}` : '').filter(Boolean)
        if (dropped.length) console.info(`[layout] axial-dropped (no coords from slot ${i}):`, dropped.join(', '))
        break
      }
      if (!label) continue

      // Staged-for-removal tiles borrow the future-remove treatment: this
      // pheromone is about to leave them, which is exactly what that mark
      // means. Ahead of the cursor divergence marks — an armed removal is
      // what the participant is looking at right now.
      const div = this.#tagRemovalStaged.has(label) ? 2
        : this.#tagApplyPainted.has(label) ? 1
          : this.#divergenceFutureAdds.has(label) ? 1
            : this.#divergenceFutureRemoves.has(label) ? 2 : 0
      // Heat ring = max(transient activity heat, steady peer-presence glow).
      // The activity pulse (new-cell fade, hover) still plays on top; the
      // presence glow keeps a tile lit while peers are exploring inside it.
      const heat = Math.max(this.#heatByLabel.get(label) ?? 0, this.#presenceGlowByLabel.get(label) ?? 0)
      const unshared = worldMode && !isCellPublic(worldLocation, label)
      // Category title tiles carry the cold-steel border so an island header
      // reads as a header — no new tile shape needed.
      const borderColor = cluster?.headers.has(label) ? HEADER_BORDER : undefined
      // Clustered help tiles render PLAIN — no photo/substrate imagery — so the
      // category words and steel headers read cleanly.
      // A tile showing a spotlit participant's version is external for
      // this pass even though the name is yours: the bytes on screen
      // are theirs, so it must take the publisher-image path and skip
      // the local prop reads that would paint your picture back over
      // it. Dismissing the spotlight empties the set and the tile is
      // plainly yours again.
      const external = !localCellSet.has(label) || this.#stackVariantLabels.has(label)
      // COLLECTION RIM (see COLLECTED_BORDER): mark what the swarm brought
      // you vs what it merely shows you. Both predicates are parse-cached
      // map lookups — render-loop safe.
      let rim = borderColor
      if (!rim) {
        const tilePath = [...collectionSegs, label]
        if (!external && (visitRecordAt(tilePath) !== null || isWithinAdoptedRoot(tilePath))) rim = COLLECTED_BORDER
        else if (external) rim = WITNESSED_BORDER
      }
      out.push({ q: a.q, r: a.r, label, external, heat, hasBranch: branchSet?.has(label) ?? false, divergence: div, unshared, borderColor: rim, plain: !!cluster })
    }

    return out
  }

  /** Read each cell's picture and properties (tile-faces.ts), then prove the
   *  branches' insides (tile-readiness.ts). */
  private loadCellImages = async (
    cells: Cell[],
    dir: FileSystemDirectoryHandle | null,
    forceReload?: Set<string>,
    segmentsOverride?: readonly string[],
    prepareOnly = false,
  ): Promise<void> => {
    const renderSegments = await this.#faces.load(cells, dir, forceReload, segmentsOverride, prepareOnly)
    if (!renderSegments) return

    // Children-readiness shade: once the visible cells' OWN images resolve,
    // drive each BRANCH tile's shade off whether the tiles INSIDE it (its
    // direct children) have their images present — a branch un-shades only
    // when clicking it would land on an already-bright view. Fire-and-forget;
    // warms any missing child images and forces one repaint when a readiness
    // bit flips (buildCellsKey folds the shade bit → rebake).
    if (!prepareOnly) void this.#readiness.compute(cells, renderSegments)

    // TileReadiness owns click-target baking. Keeping a second
    // independent pre-bake walk here caused duplicate decode/upload work and
    // atlas churn after a tile had already become ready.
  }

  /** CLICK → TILES, AS ONE NUMBER: when a navigation started. */
  #onNavigateStarted = (): void => { this.#navStartedAt = performance.now() }

  /** Take a manifest entry's inlined visual into the pack (packed-visuals.ts).
   *  Kept on the drone because the history service reaches it here. */
  public static adoptPackedVisual(entry: PackedVisualEntry): void {
    adoptPackedVisual(entry)
  }

  /** The tile under the pointer shows at full opacity while hovered, and only
   *  while hovered. Two cells change at most — the one entered and the one
   *  left — so this writes exactly those, never a pass. */
  #setHoverOpaque = (label: string | null): void => {
    const next = label && this.renderedCells.has(label) ? label : null
    if (next === this.#hoverOpaqueLabel) return
    const previous = this.#hoverOpaqueLabel
    this.#hoverOpaqueLabel = next
    // Attribute writes only — never a render:cell-count emit. That payload
    // doubles as the overlay's "maps are fresh, release the navigation guard"
    // signal, and a hover must never be able to say that (see
    // #repaintReadinessInPlace for the mid-navigation failure it caused).
    this.#writeShadeFor(previous)   // back to its honest state
    this.#writeShadeFor(next)       // lifted under the pointer
  }

  /** A take touched `label`: lift it out of the swarm's shade this frame and
   *  stamp the bright taking rim — the prominent "this one is now being
   *  added" the gesture needs while its fold is still landing. Attribute
   *  writes only; the next full render paints the tile native. */
  #flashWandTake(label: string): void {
    this.#wandTakingLabels.add(label)
    const i = this.#labelToIndex.get(label)
    if (i === undefined || !this.geom) return
    const shadedBuf = this.#buf?.shaded
    if (shadedBuf) {
      this.#shadedLabels.delete(label)
      this.#writeCellScalar(shadedBuf, i, 0)
      this.#pushBuffer('aShaded')
    }
    const borderBuf = this.#buf?.borderColor
    if (borderBuf) {
      this.#writeCellRgb(borderBuf, i, WAND_TAKING_BORDER[0], WAND_TAKING_BORDER[1], WAND_TAKING_BORDER[2])
      this.#pushBuffer('aBorderColor')
    }
  }

  /** Write one cell's current shade value into the geometry and push it. */
  #writeShadeFor(label: string | null): boolean {
    if (!label) return false
    const cell = this.renderedCells.get(label)
    const shadedBuf = this.#buf?.shaded
    const i = this.#labelToIndex.get(label)
    if (!cell || !shadedBuf || i === undefined || !this.geom) return false
    const shaded = this.#cellIsShaded(cell)
    if (shaded) this.#shadedLabels.add(label)
    else this.#shadedLabels.delete(label)
    // Hover lifts instantly (it is a pointer response, not an arrival); a real
    // release fades. #shadeValueFor honours whichever is in play.
    this.#writeCellScalar(shadedBuf, i, this.#shadeValueFor(cell))
    return this.#pushBuffer('aShaded')
  }

  // ── Fade-in ────────────────────────────────────────────────────────────
  // A tile that has EARNED brightness fades in rather than snapping: the eye
  // catches which tile just became clickable, and a page warming in gives the
  // participant a continuous read on what has landed. The ramp is an attribute
  // write per frame on the fading cells only — never a render pass.

  /** label → the timestamp its release started. Absent = not fading. */
  readonly #shadeFadeStartedAt = new Map<string, number>()
  #shadeFadeFrame: number | null = null

  /** Current shade strength for a cell: 1 while it is still preloading, then
   *  ramping 1 → 0 across SHADE_FADE_MS once it has been released. */
  #shadeValueFor(c: Cell): number {
    if (this.#cellIsShaded(c)) return 1
    const startedAt = this.#shadeFadeStartedAt.get(c.label)
    if (startedAt === undefined) return 0
    const elapsed = performance.now() - startedAt
    if (elapsed >= SHADE_FADE_MS) {
      this.#shadeFadeStartedAt.delete(c.label)
      return 0
    }
    // ease-out: most of the lift happens early, so arrival reads as arrival.
    const k = 1 - elapsed / SHADE_FADE_MS
    return k * k
  }

  #beginShadeFade(label: string): void {
    if (this.#shadeFadeStartedAt.has(label)) return
    this.#shadeFadeStartedAt.set(label, performance.now())
    this.#pumpShadeFade()
  }

  #pumpShadeFade = (): void => {
    if (this.#shadeFadeFrame !== null || this.#shadeFadeStartedAt.size === 0) return
    this.#shadeFadeFrame = requestAnimationFrame(() => {
      this.#shadeFadeFrame = null
      const shadedBuf = this.#buf?.shaded
      if (!shadedBuf || !this.geom) { this.#shadeFadeStartedAt.clear(); return }
      for (const label of [...this.#shadeFadeStartedAt.keys()]) {
        const cell = this.renderedCells.get(label)
        const i = this.#labelToIndex.get(label)
        if (!cell || i === undefined) { this.#shadeFadeStartedAt.delete(label); continue }
        this.#writeCellScalar(shadedBuf, i, this.#shadeValueFor(cell))
      }
      this.#pushBuffer('aShaded')
      this.#pumpShadeFade()
    })
  }

  /** PREPARE A VIEW — build the destination's complete first paint AHEAD of
   *  the click: membership, durable order, cell display properties, label and
   *  image atlas entries, cells-cache object, and viewport snapshot.
   *
   *  MEASURED, and the reason this exists: with every byte local AND every
   *  child image already decoded in the atlas, a first entry still cost ~160-190ms
   *  while a revisit cost 4ms. The difference is not bytes and not pixels — it
   *  is this resolution. Proving bytes therefore never proved "instant"; the
   *  shade said ready while the view was still cold. Preparing the view is what
   *  connects the two.
   *
   *  GLOBAL BY CONSTRUCTION: the memo is keyed by the layer's CONTENT SIG, so
   *  a prepared view is valid from anywhere, forever — content-addressed layers
   *  are atomic, a changed child set is a different sig and simply misses. So
   *  this can be run over the whole hive (usage-ordered by the preloader,
   *  proximity-ordered by the visible branches) and never goes stale.
   *
   *  Writes the memo under EXACTLY the render pass's own conditions (complete
   *  names + settled branch status), using the same resolver — a memo built
   *  over a cold branch status would paint a branch as a leaf and lock the tile
   *  out of navigation. */
  prepareView = async (layerSig: string, segments: readonly string[]): Promise<boolean> => {
    if (!layerSig || !isSignature(layerSig)) return false
    const locationKey = segments.length ? `/${segments.join('/')}` : '/'
    if (
      this.#completeChildNamesByParentSig.has(layerSig)
      && this.#layerCellsCache.has(locationKey)
      && this.#layerViewportCache.has(locationKey)
    ) return true
    const existing = this.#viewPrepInFlight.get(layerSig)
    if (existing) return existing
    const preparation = this.#prepareView(layerSig, segments, locationKey)
    this.#viewPrepInFlight.set(layerSig, preparation)
    try { return await preparation }
    finally {
      if (this.#viewPrepInFlight.get(layerSig) === preparation) {
        this.#viewPrepInFlight.delete(layerSig)
      }
    }
  }

  #prepareView = async (
    layerSig: string,
    segments: readonly string[],
    locationKey: string,
  ): Promise<boolean> => {
    try {
      const history = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
      const axial = this.resolve<any>('axial')
      if (!history || !axial?.items || !this.imageAtlas || !this.atlas) return false
      const content = await history.getLayerBySig(layerSig)
      if (!content) return false
      // Nothing inside = nothing to prepare: an empty view is already instant.
      const expected = Array.isArray(content.children) ? content.children.length : 0
      if (expected === 0) return true

      let memo = this.#completeChildNamesByParentSig.get(layerSig)
      if (!memo || memo.names.length !== expected) {
        const stats = { expected: 0, resolved: 0, unresolvedSigs: [] as string[] }
        const branches = new Set<string>()
        const branchStats = { cold: false }
        const membershipGenerationAtStart = this.#membershipGeneration
        const resolved = await resolveChildNames(history, segments, null, content, layerSig, stats, branches, branchStats)
        const complete = stats.expected > 0 && stats.resolved >= stats.expected
        if (!complete || branchStats.cold) return false
        // A child was added or removed while this resolved: the answer is
        // pre-add and may not become the memo or the fast-path cells.
        if (membershipGenerationAtStart !== this.#membershipGeneration) return false
        const names: string[] = []
        for (const n of resolved) if (typeof n === 'string' && n.length > 0) names.push(n)
        if (this.#completeChildNamesByParentSig.size > ShowCellDrone.#PREPARED_VIEW_CAP) {
          const oldest = this.#completeChildNamesByParentSig.keys().next().value
          if (oldest !== undefined) this.#completeChildNamesByParentSig.delete(oldest)
        }
        memo = { names, branches: [...branches] }
        this.#completeChildNamesByParentSig.set(layerSig, memo)
        this.#preparedViewPath.set(layerSig, segments.join('/'))
      }

      // "Prepared" must mean the whole first paint, not merely child names.
      // Resolve durable tile order, hydrate every per-cell display cache, and
      // build the same cache object the revisit fast path consumes.
      const localCellSet = new Set(memo.names)
      const branchSet = new Set(memo.branches)
      const ordered = await this.#order.pinned(
        null as unknown as FileSystemDirectoryHandle,
        [...memo.names],
        localCellSet,
        true,
        undefined,
        segments,
        true,
      )
      const axialMax = typeof axial.items.size === 'number' ? axial.items.size : ordered.length
      const cells = this.buildCellsFromAxial(
        axial,
        ordered,
        Math.min(ordered.length, axialMax),
        localCellSet,
        branchSet,
      )
      if (cells.length !== memo.names.length) return false
      await this.loadCellImages(cells, null, undefined, segments, true)
      this.#layerCellsCache.set(locationKey, {
        cells: [...cells],
        cellNames: ordered,
        localCellSet,
        branchSet,
      })

      // The fast path must not discover viewport state after the click. An
      // absent viewport is still a prepared result; cache an empty snapshot,
      // while retaining the one-shot adopted-content fit decision.
      if (!this.#layerViewportCache.has(locationKey)) {
        const viewport = await readViewportAt(segments)
        this.#layerViewportCache.set(locationKey, viewport ?? {})
        if (
          !viewport
          && isWithinAdoptedRoot(segments)
          && !(await hasPersistedViewportAt(segments))
        ) {
          this.#preparedFirstVisitFit.add(locationKey)
        }
      }
      if (DIAG) console.info(`[diag:readiness] view prepared ${layerSig.slice(0, 8)} location=${locationKey} names=${ordered.length} fullPaint=1`)
      return true
    } catch { return false }
  }

  /** Coalesced repaint for readiness transitions. Tile releases and warm
   *  completions request ONE repaint per short window instead of forcing a
   *  full render pass EACH — per-event forcing at scale stacked dozens of
   *  back-to-back full passes and pegged the main thread for tens of seconds
   *  (the frozen-renderer failure). The window is SHORT (60ms) so tiles
   *  visibly brighten one by one as each completes — only near-simultaneous
   *  completions share a flip. */
  #scheduleReadinessRepaint = (): void => {
    if (this.#readinessRepaintTimer) return
    this.#readinessRepaintTimer = setTimeout(() => {
      this.#readinessRepaintTimer = null
      // ONLY THE TILES THAT CHANGED. Brightening is an attribute flip, not a
      // geometry change, so a release writes `aShaded` for exactly the cells
      // that just earned it and pushes that one buffer. Repainting the whole
      // screen for each of them is what a page of releasing tiles used to
      // cost — and full passes compete with the very click this is meant to
      // make instant. Full render only when the in-place write cannot apply
      // (membership changed, buffers not built yet).
      if (this.#repaintReadinessInPlace()) return
      if (DIAG) console.info('[diag:readiness] repaint fire (full pass)')
      this.#forceNextRender = true
      this.requestRender()
    }, 30)
  }

  /** Flip `aShaded` to bright for every shaded cell that has since earned it,
   *  push that single attribute buffer, and re-emit the cell payload so the
   *  overlay's inertness mirror keeps step. Returns false when a full pass is
   *  genuinely needed. Never flips a cell back to shaded — releases are
   *  one-way within a visit, so a would-be re-shade means the membership
   *  changed and the full path owns it. */
  #repaintReadinessInPlace = (): boolean => {
    const shadedBuf = this.#buf?.shaded
    if (!shadedBuf || !this.geom || this.#shadedLabels.size === 0) return false
    const flipped: string[] = []
    for (const label of [...this.#shadedLabels]) {
      const cell = this.renderedCells.get(label)
      if (!cell) return false
      if (this.#cellIsShaded(cell)) continue
      const i = this.#labelToIndex.get(label)
      if (i === undefined) return false
      this.#shadedLabels.delete(label)
      // Start the fade rather than snapping to full — the ramp owns this
      // cell's attribute from here (see #pumpShadeFade).
      this.#beginShadeFade(label)
      this.#writeCellScalar(shadedBuf, i, this.#shadeValueFor(cell))
      flipped.push(label)
    }
    if (flipped.length === 0) return false
    if (!this.#pushBuffer('aShaded')) return false
    // Update only the readiness gate. Re-emitting render:cell-count here can
    // release navigation against a partial renderedCells snapshot.
    this.emitEffect('render:tile-readiness', { shadedLabels: this.#preloadingLabels() })
    // NO render:cell-count from here. That payload means "the maps describe
    // the level on screen — release the navigation guard", and an in-place
    // shade flip is not that: fired from a retry timer it can land MID-
    // NAVIGATION with a partial renderedCells snapshot, rebuilding the
    // overlay's occupancy maps from garbage and releasing the guard early
    // (observed live: a 1-cell payload while a 12-child page was still
    // rendering). The narrow readiness event above updates only the gate and
    // cannot be confused with a completed level render.
    //
    // Safe to recompute the WHOLE key only because it describes cells and
    // nothing else. It must never carry an atlas eviction generation again:
    // this path re-baked nothing, so adopting one here would retire a pending
    // rebake and strand the wiped slots (band, no name). See #bakedLabelAtlasGen.
    this.renderedCellsKey = this.buildCellsKey([...this.renderedCells.values()])
    if (DIAG) console.info(`[diag:readiness] brightened in place: ${flipped.join(',')}`)
    return true
  }

  /** The identity of a baked geometry (tile-fill-geometry.ts fillKey).
   *  NO ATLAS EVICTION GENERATIONS IN HERE: those live in #bakedImageAtlasGen /
   *  #bakedLabelAtlasGen, checked separately by applyGeometry — a path that
   *  recomputes this key after touching one attribute must never be able to
   *  mark a rebake done without doing it. */
  private buildCellsKey = (cells: Cell[]): string => fillKey(cells, this.#look)

  /** How each tile looks right now, for the geometry (tile-fill-geometry.ts). */
  readonly #look: TileLook = {
    flat: () => this.#flat,
    pivot: () => this.#pivot,
    onLauncherPage: () => isLauncherLocation(this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')?.explorerSegments?.() ?? []),
    revealLabel: () => this.#hoverRevealLabel,
    hasImage: sig => !!this.imageAtlas?.hasImage(sig),
    imageUV: sig => this.imageAtlas?.getImageUV(sig) ?? null,
    labelUV: (label, ownPage) => this.atlas!.getLabelUV(
      ownPage && this.#pendingCellMutations.has(label) && !this.atlas!.hasLabel(label) ? PENDING_CELL_LABEL : label,
    ),
    hidesName: (hideText, hasImage) => this.#hidesName(hideText, hasImage),
    isHiddenItem: label => (this.#showHiddenItems && this.#currentHiddenSet.has(label)) || this.#dormantLaunchLabels.has(label),
    isDormant: label => this.#dormantLaunchLabels.has(label),
    peerPubkey: label => this.#peerPubkeyByLabel.get(label),
    spotlight: () => this.#spotlightPubkey,
    stackDepth: label => this.#stackDepthByLabel.get(label) ?? 0,
    shadeValue: cell => this.#shadeValueFor(cell as Cell),
    isShaded: cell => this.#cellIsShaded(cell as Cell),
    isPortal: label => referenceTargetForLabel(label) !== null,
    shapeOf: label => launchShapeForLabel(label),
  }

  /** Build the page's (or, `foreign`, a dive's) fill geometry
   *  (tile-fill-geometry.ts). `foreign` — the cells belong to ANOTHER layer:
   *  read nothing location-scoped for them and overwrite none of the page's
   *  buffer bookkeeping; portals and the hover-reveal come from the caller. */
  private buildFillQuadGeometry(
    cells: Cell[], r: number, gap: number, hw: number, hh: number,
    foreign?: { portals: ReadonlySet<string>; reveal: string | null },
  ): Geometry {
    const built = buildFillQuad(cells, r, gap, hw, hh, this.#look, foreign)
    for (const [label, mode] of built.shapeModes) this.#shapeModeByLabel.set(label, mode)
    if (!foreign) {
      this.#shadedLabels.clear()
      for (const label of built.shadedLabels) this.#shadedLabels.add(label)
      // Buffer references + label→index map, so tile:saved can push in-place
      // attribute updates to the GPU without rebuilding geometry. A dive's
      // buffers are its own (see #diveLabelToIndex).
      this.#buf = built.buffers
      this.#labelToIndex.clear()
      for (let i = 0; i < cells.length; i++) this.#labelToIndex.set(cells[i].label, i)
    }
    return built.geometry
  }

  // ─────────────────────────────────────────────────────────────────────
  // DIVE — paint another layer's generation in this page's slots
  // ─────────────────────────────────────────────────────────────────────

  /** Paint a dive (or, with nothing to paint, give the page back). The
   *  generation lands WHOLE: every label baked and every picture decoded
   *  before the page's mesh is hidden, so a dive never trickles in over the
   *  tiles it replaces. Same slots, same offset, same shader — a dive is
   *  indistinguishable from the page it previews. */
  async #paintDive(input: readonly DiveCell[] | null): Promise<void> {
    const token = ++this.#diveToken
    if (!input || input.length === 0) { this.#clearDive(); return }
    const atlas = this.atlas, imageAtlas = this.imageAtlas
    if (!this.layer || !this.hexMesh || !this.shader || !atlas || !imageAtlas) { this.#clearDive(); return }

    const cells: Cell[] = input.map(d => ({
      q: d.q, r: d.r, label: d.label, external: false, imageSig: d.imageSig,
      hasBranch: d.hasBranch, hideText: d.hideText, borderColor: d.borderColor, heat: 0,
    }))
    const portals = new Set(input.filter(d => d.portal).map(d => d.label))

    // Pin the UNION of what is on screen and what is about to be: neither the
    // page underneath nor the dive may lose its glyphs or pixels to the other.
    const pageSigs = [...this.renderedCells.values()].flatMap(c => (c.imageSig ? [c.imageSig] : []))
    atlas.setPinned([...this.renderedCells.keys(), ...cells.map(c => c.label), PENDING_CELL_LABEL])
    imageAtlas.setPinned([...pageSigs, ...cells.flatMap(c => (c.imageSig ? [c.imageSig] : []))])
    for (const c of cells) atlas.getLabelUV(c.label)

    await Promise.all(cells.map(async (c) => {
      const sig = c.imageSig
      if (!sig || imageAtlas.hasImage(sig) || imageAtlas.hasFailed(sig)) return
      try {
        const blob = await this.#faces.decode(sig)
        if (blob) await imageAtlas.loadImage(sig, blob)
      } catch { /* label-only, exactly as the page would paint it */ }
    }))
    if (token !== this.#diveToken) return
    if (!this.layer || !this.hexMesh || !this.shader) { this.#clearDive(); return }

    this.#diveCells = cells
    this.#divePortals = portals
    this.#rebuildDiveGeometry()
    if (!this.#diveHidMain) { this.#diveHidMain = true; this.hexMesh.visible = false }
    this.#diveActive = true
    this.#applyDiveHover()
    this.emitEffect('render:dive-painted', { count: cells.length })
  }

  /** (Re)pack the dive's geometry through the page's own packer, in FOREIGN
   *  mode — nothing location-scoped is read and nothing of the page's buffer
   *  bookkeeping is overwritten — and put it on a mesh that shares the page's
   *  shader, at the page's own mesh offset. */
  #rebuildDiveGeometry(): void {
    if (!this.layer || !this.hexMesh || !this.shader) return
    const { circumRadiusPx, gapPx, padPx } = this.#hexGeo
    const pointReachPx = circumRadiusPx / 0.8660254
    const hexHalfW = this.#flat ? pointReachPx : circumRadiusPx
    const hexHalfH = this.#flat ? circumRadiusPx : pointReachPx
    const geom = this.buildFillQuadGeometry(
      this.#diveCells, circumRadiusPx, gapPx, hexHalfW + padPx, hexHalfH + padPx,
      { portals: this.#divePortals, reveal: this.#diveHoverLabel },
    )
    this.#diveLabelToIndex.clear()
    this.#diveCells.forEach((c, i) => this.#diveLabelToIndex.set(c.label, i))
    if (!this.#diveMesh) {
      this.#diveMesh = new Mesh({ geometry: geom as any, shader: (this.shader as any).shader, texture: Texture.WHITE as any } as any)
      ;(this.#diveMesh as any).blendMode = 'pre-multiply'
      this.layer.addChild(this.#diveMesh as any)
    } else {
      this.#diveMesh.geometry = geom
      this.#diveMesh.shader = (this.shader as any).shader
    }
    if (this.#diveGeom) { try { this.#diveGeom.destroy(true) } catch { /* gone */ } }
    this.#diveGeom = geom
    this.#diveMesh.position.set(this.hexMesh.position.x, this.hexMesh.position.y)
    this.#diveMesh.visible = true
  }

  /** The dived tile under the pointer. A picture-only tile reveals its name
   *  while hovered, as on its own page — that is a label-UV change, so the
   *  geometry is repacked (pure CPU, no I/O) only when the hover leaves or
   *  lands on such a tile. */
  #hoverDive(label: string | null): void {
    if (label === this.#diveHoverLabel) return
    const hides = (l: string | null): boolean => {
      const c = l ? this.#diveCells.find(x => x.label === l) : undefined
      return !!c && this.#hidesName(c.hideText, !!(c.imageSig && this.imageAtlas?.hasImage(c.imageSig)))
    }
    const repack = this.#diveActive && (hides(this.#diveHoverLabel) || hides(label))
    this.#diveHoverLabel = label
    if (repack) this.#rebuildDiveGeometry()
    if (this.#diveActive) this.#applyDiveHover()
  }

  #applyDiveHover(): void {
    const i = this.#diveHoverLabel ? this.#diveLabelToIndex.get(this.#diveHoverLabel) : undefined
    this.shader?.setHoveredIndex(i ?? -1)
  }

  /** Give the page back exactly as it was: its mesh, its pins, its hover —
   *  and the render pass a synchronize may have queued while the dive owned
   *  the surface. Safe to call twice. */
  #clearDive(): void {
    this.#diveToken++
    const wasActive = this.#diveActive
    this.#diveActive = false
    if (this.#diveMesh) {
      try { this.layer?.removeChild(this.#diveMesh) } catch { /* gone */ }
      try { this.#diveMesh.destroy?.() } catch { /* gone */ }
      this.#diveMesh = null
    }
    if (this.#diveGeom) {
      try { this.#diveGeom.destroy(true) } catch { /* gone */ }
      this.#diveGeom = null
    }
    this.#diveCells = []
    this.#divePortals = new Set<string>()
    this.#diveLabelToIndex.clear()
    this.#diveHoverLabel = null
    if (this.#diveHidMain) {
      this.#diveHidMain = false
      if (this.hexMesh && this.renderedCount > 0) this.hexMesh.visible = true
    }
    // Announced even when nothing was up: a dive that could not be painted
    // (no mesh yet, no shader) reads as "the page is showing" to the wave
    // view, which then lets go of the pointer instead of holding a dive that
    // never landed.
    this.emitEffect('render:dive-painted', { count: 0 })
    if (!wasActive) return
    this.atlas?.setPinned([...this.renderedCells.keys(), PENDING_CELL_LABEL])
    this.imageAtlas?.setPinned([...this.renderedCells.values()].flatMap(c => (c.imageSig ? [c.imageSig] : [])))
    const restored = this.#hoverRevealLabel ? this.#labelToIndex.get(this.#hoverRevealLabel) : undefined
    this.shader?.setHoveredIndex(restored ?? -1)
    this.requestRender()
  }

  // ─────────────────────────────────────────────────────────────────────
  // Per-cell buffer slice accessors — the standard way to write cell data
  // into a geometry attribute buffer. All per-cell writes go through these
  // helpers; the strides are not repeated anywhere else in this file.
  //
  // Each hex is a quad with 4 vertices. Attributes come in three shapes:
  //   - scalar (1 float/vertex) → 4 floats per cell
  //   - rgb    (3 floats/vertex) → 12 floats per cell
  //   - vec4   (4 floats/vertex) → 16 floats per cell
  // ─────────────────────────────────────────────────────────────────────

  #writeCellScalar(buf: Float32Array | undefined, i: number, value: number): void {
    if (!buf) return
    const b = i * 4
    buf[b] = value; buf[b + 1] = value; buf[b + 2] = value; buf[b + 3] = value
  }

  #writeCellRgb(buf: Float32Array | undefined, i: number, r: number, g: number, bl: number): void {
    if (!buf) return
    const b = i * 12
    for (let v = 0; v < 4; v++) {
      buf[b + v * 3] = r; buf[b + v * 3 + 1] = g; buf[b + v * 3 + 2] = bl
    }
  }

  #writeCellVec4(buf: Float32Array | undefined, i: number, a: number, b: number, c: number, d: number): void {
    if (!buf) return
    const base = i * 16
    for (let v = 0; v < 4; v++) {
      buf[base + v * 4] = a; buf[base + v * 4 + 1] = b
      buf[base + v * 4 + 2] = c; buf[base + v * 4 + 3] = d
    }
  }

  /** Push a named attribute's CPU-side buffer to the GPU. Returns false if not available. */
  #pushBuffer(attrName: string): boolean {
    const g = this.geom as any
    try {
      g?.getAttribute?.(attrName)?.buffer?.update?.()
      return true
    } catch { return false }
  }

  /**
   * Phase 2 fast path for tile:saved — mutate the single cell's attribute
   * slices directly and push to GPU. Skips geometry rebuild entirely.
   * Returns true on success; false if the caller should fall back to the
   * incremental render path.
   */
  /** Would this cell's name be hidden right now? True only for a hideText
   *  tile whose image is actually in the atlas (an image that has not
   *  landed yet never hid anything) — and never for the hovered tile,
   *  which is the whole point of the reveal. */
  /** The DOM name layer (tile-name.drone.ts) asks these two; the answers are
   *  the SDF path's own, so the two paths can never disagree. */
  public readonly nameHidden = (label: string): boolean => this.#labelIsHidden(label)
  public readonly shaderDrawsName = (label: string): boolean =>
    (this.#shapeModeByLabel.get(label) ?? 0) > 0

  #labelIsHidden(label: string): boolean {
    if (label === this.#hoverRevealLabel) return false
    // A tile under a live edit hides its name by the EDIT, not by what is stored.
    const preview = this.#tilePreview
    if (preview?.label === label) {
      if (!preview.hideText || preview.removed) return false
      const picture = this.#flat ? preview.flat : preview.point
      const sig = picture?.sig ?? this.#faces.images.get(label)
      return this.#hidesName(true, !!(sig && this.imageAtlas?.getImageUV(sig)))
    }
    const cell = this.renderedCells.get(label)
    if (!cell?.hideText || cell.plain || !cell.imageSig) return false
    return this.#hidesName(true, !!this.imageAtlas?.getImageUV(cell.imageSig))
  }

  /** Point the hover reveal at `next` and repaint just the tiles whose
   *  hidden-ness actually flipped. Touches one attribute for at most two
   *  cells, so it is cheap enough to run on every hover change; tiles that
   *  never hide their text cost nothing but a map lookup. */
  #setHoverReveal(next: string | null): void {
    const prev = this.#hoverRevealLabel
    if (prev === next) return

    // Only a tile that HIDES its text can change appearance here. Resolve
    // that against the pre-flip state for `prev` and the post-flip state
    // for `next`, so each is judged as the reveal actually leaves it.
    const wasHiding = (l: string | null): boolean => {
      if (!l) return false
      const cell = this.renderedCells.get(l)
      if (!cell?.hideText || cell.plain || !cell.imageSig) return false
      return this.#hidesName(true, !!this.imageAtlas?.getImageUV(cell.imageSig))
    }
    const prevFlips = wasHiding(prev)   // prev was revealed → re-hide it
    const nextFlips = wasHiding(next)   // next was hidden → reveal it

    this.#hoverRevealLabel = next
    if (!prevFlips && !nextFlips) return

    const labelUV = this.#buf.labelUV
    if (!labelUV || !this.atlas || !this.geom) return

    for (const l of [prevFlips ? prev : null, nextFlips ? next : null]) {
      if (!l) continue
      const i = this.#labelToIndex.get(l)
      if (i === undefined) continue
      if (this.#labelIsHidden(l)) {
        this.#writeCellVec4(labelUV, i, 0, 0, 0, 0)
      } else {
        const r = this.atlas.getLabelUV(l)
        this.#writeCellVec4(labelUV, i, r.u0, r.v0, r.u1, r.v1)
      }
    }
    this.#pushBuffer('aLabelUV')
  }

  // ─────────────────────────────────────────────────────────────────────
  // LIVE PREVIEW — the tile editor's edit, on its own tile
  // ─────────────────────────────────────────────────────────────────────
  //
  // While a tile is being edited, its hexagon in the hive shows the edit as it
  // happens: the framing, a new picture or none, the rim colour, whether the
  // name shows. It is painted the way #tryInPlaceCellUpdate paints a saved
  // change — attribute writes on one tile, never a render pass — but from the
  // editor's payload, and it is NEVER written into a cache: the caches go on
  // describing what is stored, so ending a preview is a repaint from them.
  //
  // The pictures are the exact bytes a save writes (one capture function, one
  // deterministic output), loaded under their real signatures — so when the
  // save lands, its new picture is already on the GPU and nothing flashes.

  #tilePreview: TilePreview | null = null
  #tilePreviewToken = 0
  /** The tile the newest payload named ('' after a clear). */
  #tilePreviewLatest = ''
  /** The tile a save just landed on — its preview's end must not repaint the
   *  old caches, because the save's own render is about to paint the truth.
   *  Held until that tile is previewed again. */
  #tilePreviewSavedLabel = ''

  #tilePreviewSigs(): string[] {
    const p = this.#tilePreview
    if (!p || p.removed) return []
    return [p.point?.sig, p.flat?.sig].filter((sig): sig is string => !!sig)
  }

  #currentPageKey(): string {
    return ((this.resolve<any>('lineage')?.explorerSegments?.() ?? []) as unknown[])
      .map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  #applyTilePreview = async (payload: TilePreviewPayload | null | undefined): Promise<void> => {
    if (!payload?.label) return
    const token = ++this.#tilePreviewToken
    this.#tilePreviewLatest = payload.clear ? '' : payload.label

    if (payload.clear) {
      const ended = this.#tilePreview
      this.#tilePreview = null
      if (!ended) return
      // A save announces tile:saved in the same turn it ends the preview — or,
      // when the docked editor saves and moves to another tile, just before.
      // Wait the turn out: repaint from the caches only if no save came, and
      // only if the same tile has not been taken up again meanwhile. A preview
      // of a DIFFERENT tile arriving in between (the editor moving on) does not
      // stop this one's tile being put back.
      setTimeout(() => {
        if (this.#tilePreviewLatest === ended.label) return
        if (this.#tilePreviewSavedLabel === ended.label) return
        this.#restoreTileFromCaches(ended.label)
      }, 0)
      return
    }

    // Previewed again: an earlier save of this tile no longer describes it.
    if (payload.label === this.#tilePreviewSavedLabel) this.#tilePreviewSavedLabel = ''

    if (payload.page !== this.#currentPageKey()) return
    const atlas = this.imageAtlas
    // Decode both orientations before anything is swapped, so the tile never
    // paints an empty slot mid-edit and an orientation flip finds its picture.
    if (atlas && !payload.removed) {
      const pictures = [payload.point, payload.flat].filter((p): p is TilePreviewPicture => !!p)
      await Promise.all(pictures.map(p => atlas.loadImage(p.sig, p.blob).catch(() => null)))
    }
    if (token !== this.#tilePreviewToken) return
    this.#tilePreview = payload
    atlas?.setPinned([
      ...[...this.renderedCells.values()].flatMap(c => (c.imageSig ? [c.imageSig] : [])),
      ...this.#tilePreviewSigs(),
    ])
    this.#writeTilePreview()
  }

  /** Paint the preview onto its tile. False when there is nothing to paint or
   *  the tile is not in the current geometry. */
  #writeTilePreview(): boolean {
    const preview = this.#tilePreview
    if (!preview) return false
    const i = this.#labelToIndex.get(preview.label)
    const { imageUV, hasImage, borderColor, labelUV } = this.#buf
    if (i === undefined || !imageUV || !hasImage || !borderColor || !labelUV) return false
    if (!this.geom || !this.imageAtlas || !this.atlas) return false

    const picture = this.#flat ? preview.flat : preview.point
    const stored = this.#faces.images.get(preview.label)
    let uv = preview.removed
      ? null
      : picture
        ? this.imageAtlas.getImageUV(picture.sig)
        : (stored ? this.imageAtlas.getImageUV(stored) : null)
    if (!preview.removed && picture && !uv) {
      // Evicted or not decoded yet: keep what the tile shows and paint again
      // the moment it lands.
      uv = stored ? this.imageAtlas.getImageUV(stored) : null
      void this.imageAtlas.loadImage(picture.sig, picture.blob)
        .then(() => { if (this.#tilePreview === preview) this.#writeTilePreview() })
        .catch(() => { /* the stored picture stays */ })
    }

    this.#writeCellVec4(imageUV, i, uv?.u0 ?? 0, uv?.v0 ?? 0, uv?.u1 ?? 0, uv?.v1 ?? 0)
    this.#writeCellScalar(hasImage, i, uv ? 1 : 0)

    const [r, g, b] = previewRgb(preview.border) ?? PREVIEW_DEFAULT_BORDER
    this.#writeCellRgb(borderColor, i, r, g, b)

    if (this.#hidesName(preview.hideText, !!uv) && preview.label !== this.#hoverRevealLabel) {
      this.#writeCellVec4(labelUV, i, 0, 0, 0, 0)
    } else {
      const ruv = this.atlas.getLabelUV(preview.label)
      this.#writeCellVec4(labelUV, i, ruv.u0, ruv.v0, ruv.u1, ruv.v1)
    }

    const pushed = this.#pushBuffer('aImageUV') && this.#pushBuffer('aHasImage')
      && this.#pushBuffer('aBorderColor') && this.#pushBuffer('aLabelUV')
    // Tile names are real DOM text (tile-name.drone) — tell them to re-ask.
    this.emitEffect('render:name-visibility', { label: preview.label })
    return pushed
  }

  /** A preview ended with no save: paint the tile from the caches again. */
  #restoreTileFromCaches(label: string): void {
    const i = this.#labelToIndex.get(label)
    const { imageUV, hasImage, borderColor, labelUV } = this.#buf
    if (i === undefined || !imageUV || !hasImage || !borderColor || !labelUV || !this.geom || !this.imageAtlas || !this.atlas) {
      this.requestRender()
      return
    }
    const sig = this.#faces.images.get(label) ?? null
    const uv = sig ? this.imageAtlas.getImageUV(sig) : null
    if (sig && !uv) { this.requestRender(); return }
    this.#writeCellVec4(imageUV, i, uv?.u0 ?? 0, uv?.v0 ?? 0, uv?.u1 ?? 0, uv?.v1 ?? 0)
    this.#writeCellScalar(hasImage, i, uv ? 1 : 0)
    const [r, g, b] = this.#faces.borders.get(label) ?? PREVIEW_DEFAULT_BORDER
    this.#writeCellRgb(borderColor, i, r, g, b)
    const hideText = this.#faces.hiddenText.get(label) ?? false
    if (this.#hidesName(hideText, !!uv) && label !== this.#hoverRevealLabel) {
      this.#writeCellVec4(labelUV, i, 0, 0, 0, 0)
    } else {
      const ruv = this.atlas.getLabelUV(label)
      this.#writeCellVec4(labelUV, i, ruv.u0, ruv.v0, ruv.u1, ruv.v1)
    }
    // The editor may already be previewing the next tile — keep its pictures.
    this.imageAtlas.setPinned([
      ...[...this.renderedCells.values()].flatMap(c => (c.imageSig ? [c.imageSig] : [])),
      ...this.#tilePreviewSigs(),
    ])
    this.#pushBuffer('aImageUV')
    this.#pushBuffer('aHasImage')
    this.#pushBuffer('aBorderColor')
    this.#pushBuffer('aLabelUV')
    this.emitEffect('render:name-visibility', { label })
  }

  readonly #tryInPlaceCellUpdate = async (
    label: string,
    _ctx: { dir: FileSystemDirectoryHandle | null },
  ): Promise<boolean> => {
    const i = this.#labelToIndex.get(label)
    if (i === undefined) return false
    const { imageUV, hasImage, borderColor, labelUV } = this.#buf
    if (!imageUV || !hasImage || !borderColor || !labelUV) return false
    if (!this.geom || !this.imageAtlas || !this.atlas) return false

    const lineage = this.resolve<any>('lineage')
    const dir = _ctx.dir ?? (await lineage?.explorerDir?.())
    if (!dir) return false

    // Force-reload this cell so the loader bypasses the fast path
    // (which would otherwise serve the stale cached sig — substrate
    // has just written a new propsSig for this label).
    const probe: Cell = { q: 0, r: 0, label, external: false }
    try { await this.loadCellImages([probe], dir, new Set([label])) } catch { return false }

    const sig = this.#faces.images.get(label) ?? null
    const imgUV = sig ? (this.imageAtlas.getImageUV(sig) ?? null) : null

    if (imgUV) {
      this.#writeCellVec4(imageUV, i, imgUV.u0, imgUV.v0, imgUV.u1, imgUV.v1)
    } else {
      this.#writeCellVec4(imageUV, i, 0, 0, 0, 0)
    }
    this.#writeCellScalar(hasImage, i, imgUV ? 1 : 0)

    const [bcr, bcg, bcb] = this.#faces.borders.get(label) ?? [0.784, 0.592, 0.353]
    this.#writeCellRgb(borderColor, i, bcr, bcg, bcb)

    // labelUV: collapse to origin when hideText + image so the label is
    // hidden — unless this is the hovered tile, which is revealing its name,
    // or text-only mode is on, where no tile hides its name (#hidesName).
    const ht = this.#faces.hiddenText.get(label) ?? false
    if (this.#hidesName(ht, !!imgUV) && label !== this.#hoverRevealLabel) {
      this.#writeCellVec4(labelUV, i, 0, 0, 0, 0)
    } else {
      const atlasLabel = this.#pendingCellMutations.has(label) && !this.atlas.hasLabel(label)
        ? PENDING_CELL_LABEL
        : label
      const ruv = this.atlas.getLabelUV(atlasLabel)
      this.#writeCellVec4(labelUV, i, ruv.u0, ruv.v0, ruv.u1, ruv.v1)
    }

    // Readiness shade follows the fresh image state — brighten (or shade)
    // in place with the same attribute-only push, and keep the mirrored
    // inertness set in step.
    const probeCell = { ...probe, imageSig: sig ?? undefined }
    const shadedNow = this.#cellIsShaded(probeCell)
    if (shadedNow) this.#shadedLabels.add(label)
    else if (this.#shadedLabels.delete(label)) this.#beginShadeFade(label)
    this.#writeCellScalar(this.#buf.shaded, i, this.#shadeValueFor(probeCell))

    if (!this.#pushBuffer('aImageUV') || !this.#pushBuffer('aHasImage') || !this.#pushBuffer('aBorderColor') || !this.#pushBuffer('aLabelUV') || !this.#pushBuffer('aShaded')) {
      return false
    }

    const rec = this.renderedCells.get(label)
    if (rec) {
      rec.imageSig = sig ?? undefined
      rec.borderColor = [bcr, bcg, bcb]
      rec.hasLink = this.#faces.links.get(label) ?? false
      rec.hasSubstrate = this.#faces.substrates.get(label) ?? false
      rec.hideText = ht
      const cellsSnapshot = [...this.renderedCells.values()]
      // One cell's attributes were rewritten, so the cells key may legitimately
      // be re-stated here. The atlas generations may NOT — every OTHER cell's
      // label UV is untouched by this path, and claiming a generation it did
      // not apply is what left tiles with a band and no name inside it.
      this.renderedCellsKey = this.buildCellsKey(cellsSnapshot)
      // Shade state may have flipped — refresh tile-overlay's mirrored
      // sets so click inertness matches what is on screen.
      this.emitEffect('render:cell-count', this.#buildCellCountPayload(cellsSnapshot))
    }

    this.#narrow.emitRenderTags([...this.renderedCells.values()])
    return true
  }

  /**
   * Phase 2 fast path for heat — mutate just the heat slice for one cell
   * and push the aHeat buffer. Used by the new-cell fade RAF loop so it
   * never triggers a full render per frame.
   * Returns true on success; false if the label isn't currently indexed
   * (in which case the caller may skip or fall back to requestRender).
   */
  #updateCellHeat(label: string, heatValue: number): boolean {
    const i = this.#labelToIndex.get(label)
    if (i === undefined) return false
    if (!this.#buf.heat || !this.geom) return false
    this.#writeCellScalar(this.#buf.heat, i, heatValue)
    return this.#pushBuffer('aHeat')
  }
}
// THE BEE WIRES (atomic-modules-plan.md). A render-critical bee registers
// the services it needs for the first paint, so they exist before it.
window.ioc.register('@diamondcoreprocessor.com/LayoutService', new LayoutService())
window.ioc.register('@diamondcoreprocessor.com/SubstrateService', new SubstrateService())
window.ioc.register('@diamondcoreprocessor.com/HexLabelAtlasFactory', new HexLabelAtlasFactory())
window.ioc.register('@diamondcoreprocessor.com/HexSdfTextureShaderFactory', new HexSdfTextureShaderFactory())
window.ioc.register('@diamondcoreprocessor.com/CenterSlotTracker', new CenterSlotTracker())
window.ioc.register(TILE_SOURCE_REGISTRY_KEY, new TileSourceRegistry())
{
  const indexNurse = new IndexNurse()
  window.ioc.register(indexNurse.iocKey, indexNurse)
}
window.ioc.whenReady('@diamondcoreprocessor.com/LayerSlotRegistry', (slots: { register(slot: { slot: string; triggers: readonly string[] }): void }) => {
  try { slots.register(TILE_PROPERTIES_SLOT_DECLARATION) } catch (err) {
    // Idempotent re-registration with the same name + payload is safe; only a
    // collision throws. Surface anything else so a rival claim is noticed.
    console.warn('[tile-properties] slot register failed:', err)
  }
})

const showCell = new ShowCellDrone()
window.ioc.register('@diamondcoreprocessor.com/ShowCellDrone', showCell)
console.log('[hypercomb] show-cell: pendingRecenter no longer leaks across layer changes; mesh.position and overlay #meshOffset stay in sync (2026-05-07n)')
