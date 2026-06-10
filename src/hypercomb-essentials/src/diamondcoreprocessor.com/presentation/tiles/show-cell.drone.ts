// diamondcoreprocessor.com/pixi/show-cell.drone.ts
import { Drone, I18N_IOC_KEY } from '@hypercomb/core'
import type { I18nProvider } from '@hypercomb/core'
import { Application, Container, Geometry, Mesh, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { HexLabelAtlas } from '../grid/hex-label.atlas.js'
import { HexImageAtlas } from '../grid/hex-image.atlas.js'
import { HexSdfTextureShader } from '../grid/hex-sdf.shader.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY, createHexGeometry } from '../grid/hex-geometry.js'
import { isSignature, readCellProperties, writeCellProperties, cellLocationSig, readTilePropertiesAt, writeTilePropertiesAt } from '../../editor/tile-properties.js'
import { readViewportAt } from '../../editor/viewport-store.js'
import { hideStorageKey } from './tile-actions.drone.js'
import type { HistoryService, LayerContent } from '../../history/history.service.js'
import type { HistoryCursorService, CursorState } from '../../history/history-cursor.service.js'
import type { ViewportPersistence, ViewportSnapshot } from '../../navigation/zoom/zoom.drone.js'

type Axial = { q: number; r: number }
/** divergence: 0 = current, 1 = future-add (ghost), 2 = future-remove (marked) */
type Cell = { q: number; r: number; label: string; external: boolean; imageSig?: string; heat?: number; hasBranch?: boolean; hasLink?: boolean; hasSubstrate?: boolean; borderColor?: [number, number, number]; divergence?: number; hideText?: boolean }

/** Deterministic label → RGB via DJB2 hash → HSL → RGB. Returns [r, g, b] in 0–1 range. */
function labelToRgb(label: string): [number, number, number] {
  let hash = 5381
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) + hash + label.charCodeAt(i)) | 0
  hash = hash >>> 0

  const hue = (hash % 360) / 360
  const sat = 0.5
  const lit = 0.6

  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1))
  const m = lit - c / 2
  let r = 0, g = 0, b = 0
  const sector = (hue * 6) | 0
  if (sector === 0)      { r = c; g = x; b = 0 }
  else if (sector === 1) { r = x; g = c; b = 0 }
  else if (sector === 2) { r = 0; g = c; b = x }
  else if (sector === 3) { r = 0; g = x; b = c }
  else if (sector === 4) { r = x; g = 0; b = c }
  else                   { r = c; g = 0; b = x }
  return [r + m, g + m, b + m]
}

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshSub = { close: () => void }
type MeshApi = {
  ensureStartedForSig: (sig: string) => void
  awaitReadyForSig?: (sig: string, timeoutMs?: number) => Promise<void>
  getNonExpired: (sig: string) => MeshEvt[]
  getSwarmSize?: (sig: string) => number
  publish?: (kind: number, sig: string, payload: any, extraTags?: string[][]) => Promise<boolean>
  subscribe?: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
}

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
}

/**
 * Resolve a parent layer's `children` (sigs) into a Set of child
 * display names.
 *
 * Each child layer lives in the CHILD's bag (`__history__/<childLocSig>`),
 * not the parent's. We don't have a sig→name index, so the only way
 * to map a sig back to a name is to enumerate the parent's on-disk
 * children, compute each child's lineage sig, list that bag's markers,
 * and check if any marker sig matches the parent's `children` entry.
 *
 * Names whose sig matches → "allowed" in this historical layer.
 * Children that have been deleted from disk can't be resolved (no
 * lineage to query) and silently drop out — known limitation of the
 * current design (no global sig→name lookup).
 */
/**
 * Resolve a parent layer's `children` (sigs) to display names.
 *
 * Mechanical: each sig in `content.children` is a content-addressed
 * pointer to a child layer's bytes. The preloader (HistoryService.
 * getLayerBySig) returns the layer for that sig; its `name` field
 * is the child's display name. No bag scanning, no schema variants,
 * no name-based fallbacks — just sig→content lookup.
 *
 * Sigs that don't resolve are dropped silently (the layer was never
 * registered in the cache and isn't on disk anywhere).
 */
async function resolveChildNames(
  history: HistoryService,
  _parentSegments: readonly string[],
  _parentDir: FileSystemDirectoryHandle | null,
  content: { children?: string[] } | null,
  parentLayerSig?: string,
): Promise<Set<string>> {
  const out = new Set<string>()
  if (!content?.children?.length) return out

  // Children manifest fast-path. When the parent's sig is known, try
  // __manifests__/<parentSig> — a single file read returns the resolved
  // child layer objects with names already inlined. Skips the per-child
  // getLayerBySig walk entirely on cold load. Falls through to the
  // signature-resolution path on miss; commitLayer writes a fresh
  // manifest after every commit so subsequent reads stay hot.
  const store = parentLayerSig
    ? (window as any).ioc?.get?.('@hypercomb.social/Store') as {
        readChildrenManifest?: (sig: string) => Promise<Array<{ sig: string; layer: { name?: string } }> | null>
        writeChildrenManifest?: (sig: string, m: Array<{ sig: string; layer: { name?: string } }>) => Promise<void>
      } | undefined
    : undefined

  if (parentLayerSig && store?.readChildrenManifest) {
    const manifest = await store.readChildrenManifest(parentLayerSig)
    if (manifest && manifest.length === content.children.length) {
      // Manifest is current iff it covers every child sig in the parent.
      // Trust it: extract names directly, no bag walk.
      for (const entry of manifest) {
        if (entry?.layer?.name) out.add(entry.layer.name)
      }
      return out
    }
  }

  // Pure signature resolution. For each child sig in the parent's
  // layer, fetch that child's LayerContent — its `name` field is the
  // child's display name. NO folder-name lookups, NO seed-by-name
  // pre-warming. Names live inside the signed bytes, not on the
  // filesystem. getLayerBySig is content-addressed: hot from the
  // preloader cache after warmup, cold-walks bags by sig if missed.
  // Fired in parallel — every call is independent, and a single cold
  // miss serializing the whole list was the dominant per-frame cost.
  const children = await Promise.all(
    content.children.map(sig => history.getLayerBySig(sig)),
  )
  for (const child of children) {
    if (child?.name) out.add(child.name)
  }

  // Backfill the manifest for pre-existing layers committed before the
  // decoration shipped (or after a manifest GC). Idle-scheduled so the
  // current render path doesn't pay the write latency.
  if (parentLayerSig && store?.writeChildrenManifest && content.children.length === children.length) {
    const manifest: Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }> = []
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (!child) continue
      manifest.push({ sig: content.children[i], layer: child })
    }
    if (manifest.length > 0) {
      const schedule = typeof (window as any).requestIdleCallback === 'function'
        ? (cb: () => void) => (window as any).requestIdleCallback(cb, { timeout: 5_000 })
        : (cb: () => void) => setTimeout(cb, 0)
      schedule(() => { void store.writeChildrenManifest!(parentLayerSig, manifest) })
    }
  }

  return out
}

export class ShowCellDrone extends Drone {
  private static readonly STREAM_BATCH_SIZE = 8

  readonly namespace = 'diamondcoreprocessor.com'

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

  protected override listens = ['render:host-ready', 'mesh:ready', 'mesh:items-updated', 'tile:saved', 'search:filter', 'render:set-orientation', 'render:set-pivot', 'mesh:room', 'mesh:secret', 'cell:place-at', 'cell:reorder', 'render:set-gap', 'move:preview', 'clipboard:captured', 'layout:mode', 'tags:changed', 'tags:filter', 'history:cursor-changed', 'tile:toggle-text', 'visibility:show-hidden', 'overlay:neon-color', 'translation:tile-start', 'translation:tile-done', 'locale:changed', 'substrate:changed', 'substrate:ready', 'substrate:applied', 'substrate:rerolled', 'cell:added', 'cell:removed', 'swarm:peers-changed', 'swarm:resource-arrived', 'swarm:hide-changed', 'tile:hidden', 'tile:unhidden']
  protected override emits = ['mesh:ensure-started', 'mesh:subscribe', 'mesh:publish', 'render:mesh-offset', 'render:cell-count', 'render:geometry-changed', 'render:tags', 'tile:hover-tags']
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private atlas: HexLabelAtlas | null = null
  private imageAtlas: HexImageAtlas | null = null
  private atlasRenderer: unknown = null

  // cache: cell label → small image signature (avoids re-reading 0000 on every render)
  private readonly cellImageCache = new Map<string, string | null>()
  /** For EXTERNAL (peer) labels: which publisher imageSig the cached value
   *  was derived from. The publisher's CURRENT sig is authoritative — a
   *  cache entry is only reusable while its source sig is unchanged, so a
   *  stale or cross-contaminated entry can never pin a peer tile to the
   *  wrong image. */
  private readonly peerImageSourceByLabel = new Map<string, string>()
  /** Publisher image sigs from TileSourceRegistry entries (config/snapshot
   *  sources, e.g. DCP-adopted branches mounted in SOLO). Fallback source
   *  for external cells when no live swarm publisher is present. */
  private readonly registryImageByLabel = new Map<string, string>()
  // cache: cell label → tag names (avoids re-reading 0000 on every render)
  private readonly cellTagsCache = new Map<string, string[]>()
  // cache: cell label → border color RGB floats
  private readonly cellBorderColorCache = new Map<string, [number, number, number]>()
  // cache: cell label → has link property
  private readonly cellLinkCache = new Map<string, boolean>()
  // cache: cell label → is substrate-assigned image
  private readonly cellSubstrateCache = new Map<string, boolean>()
  // cache: cell label → hideText property (hide label when image shown)
  private readonly cellHideTextCache = new Map<string, boolean>()

  private lastKey = ''

  private listening = false
  private rendering = false
  private renderQueued = false

  private renderedCellsKey = ''
  private renderedCount = 0

  private lineageChangeListening = false

  // incremental rendering state — tracks what's currently painted (geometry cache)
  private readonly renderedCells = new Map<string, Cell>()
  // per-layer cache: location key → cells array (for instant back-navigation)
  #layerCellsCache = new Map<string, { cells: Cell[]; cellNames: string[]; localCellSet: Set<string>; branchSet: Set<string> }>()
  // per-layer viewport snapshot cache — skips OPFS read of `0000` on back-nav fast path.
  // Safe to keep across cell-content changes; only the persisted viewport of another
  // layer can write here, and the SPA can't reach that layer without revisiting.
  #layerViewportCache = new Map<string, ViewportSnapshot>()
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
  #axialToIndex = new Map<string, number>()
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
  #substrateFadeStart: number | null = null
  #substrateFadeRaf = 0
  #showHiddenItems = false
  #currentHiddenSet = new Set<string>()
  // Names of cells in the current render that came from an ephemeral
  // tile source (sync preview, not adopted to OPFS). Used by the pinned
  // index writer to skip per-cell OPFS writes that would NotFound, and
  // by the pixi draw path to apply the dashed-accent preview style.
  // Cleared and rebuilt on each renderFromSynchronize.
  #ephemeralCellSet = new Set<string>()

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

  // Per-session in-memory slot assignment cache. Once a tile is placed
  // via score-based logic (or any other path), its slot is remembered
  // here so later renders — including pan-triggered re-renders — re-use
  // the same slot regardless of viewport changes.
  //
  // User-spec rule: indexes are fixed; tiles never relocate on pan,
  // only on manual reorganize. The on-disk index persistence path is
  // async and can race a rapid pan; this cache fills the gap so
  // anything once placed stays put for the session.
  //
  // Cleared on location change (different lineage = different cell
  // set; stale cache entries get caught by the sparse-slot-occupied
  // check anyway, but a fresh cache per location avoids leaks).
  #sessionSlotByLabel = new Map<string, number>()

  // Currently spotlit peer pubkey (from SpotlightService), or null
  // when no layer is surfaced. Subscribed on the first heartbeat so
  // the service is registered by then. Render reads this in
  // buildCellsFromAxial to override borderColor for matching tiles.
  #spotlightPubkey: string | null = null

  // mesh scoping — space + secret feed into the signature key
  #space = ''
  #secret = ''

  // note: mesh cell state (derived on heartbeat)
  private meshSig = ''
  private meshCellsRev = 0
  private meshCells: string[] = []

  // clipboard view override — when set, render from this dir instead of explorer
  #clipboardView: { labels: Set<string>; sourceSegments: string[]; op: 'cut' | 'copy' } | null = null
  #lastCursorPosition = -1
  #lastCursorRewound = false
  #lastCursorLocationSig = ''
  private meshSub: MeshSub | null = null
  private readonly publisherId: string = (() => {
    const key = 'hc:show-honeycomb:publisher-id'
    try {
      const existing = String(localStorage.getItem(key) ?? '').trim()
      if (existing) return existing

      const next = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

      localStorage.setItem(key, next)
      return next
    } catch {
      return `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    }
  })()
  private snapshotPostedBySig = new Set<string>()
  private lastLocalCellsBySig = new Map<string, string[]>()
  private lastPublishedGrammarSig = ''
  private lastPublishedGrammarCell = ''

  // lease renewal: periodic refresh to keep tiles alive for late joiners
  #lastRefreshAtMs = new Map<string, number>()
  // sync-request: one-shot per sig arrival
  #syncRequestedBySig = new Set<string>()
  // rate-limit triggered republishes from sync-requests
  #lastTriggeredRepublishAtMs = new Map<string, number>()

  private filterKeyword = ''
  private filterTags = new Set<string>()
  /** Flat list of {label, dir} from cross-page tag scan. null = normal mode. */
  #tagFlattenResults: { label: string; dir: FileSystemDirectoryHandle }[] | null = null
  /** Saved lineage segments before entering tag filter — restored when filter clears. */
  #preFilterSegments: string[] | null = null
  private moveNames: string[] | null = null
  #divergenceFutureAdds = new Set<string>()
  #divergenceFutureRemoves = new Set<string>()
  #pendingRemoves = new Set<string>()
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

  // First-visit fit: when navigating to a layer that has no saved viewport
  // snapshot, defer layer reveal until all cells have streamed in, then run
  // zoom-to-fit so the page opens sized to its content. The fitted viewport
  // is persisted, so subsequent visits restore it (or the user's later
  // pan/zoom edits) instead of fitting again.

  // cached render context for fast move:preview path (avoids full OPFS re-read)
  private cachedCellNames: string[] | null = null
  private cachedLocalCellSet: Set<string> | null = null
  private cachedBranchSet: Set<string> | null = null

  // State machine for slot ordering — the authoritative source of cellNames
  // during incremental updates. Seeded after every full render; mutated via
  // add()/remove() by incremental paths. Encapsulates dense vs pinned logic.
  readonly #slots = new CellSlots()

  // Coalesce rapid cell:added / cell:removed events fired in the same JS turn.
  // The handlers mutate #slots synchronously; a single microtask runs one
  // applyGeometry at the end of the turn. Zero awaits in the click path.
  #pendingAdds: string[] = []
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
  } = {}
  #labelToIndex = new Map<string, number>()

  private readonly onSynchronize = (): void => {
    this.requestRender()
  }

  private readonly onLineageChange = (): void => {
    this.requestRender()
  }

  private readonly adoptHostPayload = (payload: HostReadyPayload): void => {
    this.pixiApp = payload.app
    this.pixiContainer = payload.container
    this.pixiRenderer = payload.renderer
    this.requestRender()
  }

  /** Pre-warm: preheat every known tile-props blob and its `small.image`
   *  resource so first paint finds them hot in the Store cache. Runs once
   *  after registration, before the first pulse. Best-effort. */
  public override async warmup(): Promise<void> {
    try {
      const raw = localStorage.getItem('hc:tile-props-index')
      if (!raw) return
      const propsIndex = JSON.parse(raw) as Record<string, unknown>
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
          const sig = props?.small?.image
          if (typeof sig === 'string' && /^[a-f0-9]{64}$/i.test(sig)) imageSigs.add(sig)
        } catch { /* skip malformed */ }
      }

      if (imageSigs.size) {
        await Promise.allSettled(
          [...imageSigs].map(sig => store.preheatResource!(sig).catch(() => null))
        )
      }

      this.#warmLabels = Object.keys(propsIndex)
    } catch { /* best-effort */ }
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
      await this.refreshMeshCells(grammar)
      this.requestRender()
    }
  }

  private refreshMeshCells = async (grammar: string = ''): Promise<void> => {
    // Mesh is opt-in. Default: dormant. Joining a public session sets the
    // flag below. Without it, no relay connections, no event subscriptions,
    // no per-event secp256k1 verifications. Local-only operation.
    const meshEnabled = (() => {
      try { return localStorage.getItem('hc:mesh-enabled') === 'true' } catch { return false }
    })()
    if (!meshEnabled) return

    const lineage = this.resolve<any>('lineage')
    const mesh = this.tryGetMesh()
    if (!lineage || !mesh) return

    const signatureLocation = await this.computeSignatureLocation(lineage)
    const sig = signatureLocation.sig

    if (sig !== this.meshSig) {
      const NOSTR = 'wss://relay.snort.social'
      const nakPayload = '{"cells":["external.alpha","Street Fighter"]}'
      const nakCmd = `nak event ${NOSTR} --kind 29010 --tag "x=${sig}" --content '${nakPayload}'`
      ; (window as any).__showHoneycombNakCommand = nakCmd
      // (debug logs removed — fired on every nav and slowed render with DevTools open)
    }

    if (!sig) return

    // Privacy gate — show-cell's legacy kind-29010 subscribe + publish
    // path was the un-credentialled leak the user reported ("the mesh
    // is sharing even without a location or password"). Without both
    // a room and a secret we MUST NOT subscribe (would receive other
    // peers' cached events from the relay) or publish (would broadcast
    // our local cell list to anyone listening on this lineage sig).
    // SwarmDrone has the same gate for the new kind-30200 path.
    if (!this.#space || !this.#secret) {
      // If we previously had a subscription open from a session with
      // credentials, close it now so the leak is sealed immediately
      // when the user clears credentials, not just on next lineage
      // change.
      if (this.meshSub) {
        try { this.meshSub.close() } catch { /* ignore */ }
        this.meshSub = null
      }
      this.meshSig = ''
      this.meshCells = []
      this.meshCellsRev++
      return
    }

    const sigChanged = sig !== this.meshSig

    if (sigChanged) {
      if (this.meshSub) {
        try { this.meshSub.close() } catch { /* ignore */ }
        this.meshSub = null
      }

      this.meshSig = sig
      this.meshCells = []
      this.meshCellsRev++

      if (typeof mesh.subscribe === 'function') {
        this.meshSub = mesh.subscribe(sig, (evt) => {
          // Only react to the legacy ephemeral kind that this drone owns.
          // Swarm-layer events (kind 30200) belong to SwarmDrone and don't
          // affect meshCells — re-rendering on every one of them churns
          // show-cell on each peer publish (and on our own local fanout).
          // Peer tiles still update at the next render trigger (navigation
          // / user interaction); they don't need per-event refreshes.
          const kind = Number((evt?.event as { kind?: number } | undefined)?.kind ?? 0)
          if (kind && kind !== 29010) return

          // detect sync-request from another publisher — trigger immediate republish
          this.#handleIncomingSyncRequest(evt, mesh, sig)

          void (async () => {
            await this.refreshMeshCells()
            this.requestRender()
          })()
        })
      }
    }

    // note: ensure relays are queried for this sig (direct call + effect for observability)
    mesh.ensureStartedForSig(sig)
    this.emitEffect('mesh:ensure-started', { signature: sig })


    // note: publish local filesystem cells for this sig when changed
    await this.publishLocalCells(lineage, mesh, sig, grammar)

    // note: get non-expired items (mesh owns ttl)
    const items = mesh.getNonExpired(sig)

    // sync-request: if we arrived and see no items from other publishers, ask the swarm to republish
    if (!this.#syncRequestedBySig.has(sig) && this.snapshotPostedBySig.has(sig)) {
      const hasOtherPublishers = items.some(it => {
        const pubId = this.readPublisherIdFromEvent(it?.event)
        return pubId && pubId !== this.publisherId
      })
      if (!hasOtherPublishers && typeof mesh.publish === 'function') {
        this.#syncRequestedBySig.add(sig)
        void mesh.publish(29010, sig, {
          type: 'sync-request',
          publisherId: this.publisherId,
          requestedAtMs: Date.now()
        }, [['publisher', this.publisherId], ['mode', 'sync-request']])
      }
    }

    if (!items || items.length === 0) {
      if (this.meshCells.length !== 0) {
        this.meshCells = []
        this.meshCellsRev++
      }
      return
    }

    // note: union cells across all non-expired payloads
    // - supports payload shapes:
    //   1) { cells: string[] }
    //   2) string[] (direct)
    // - any other shape is ignored
    const set = new Set<string>()
    for (const it of items) {
      const p = it?.payload

      const tagPublisherId = this.readPublisherIdFromEvent(it?.event)
      const payloadPublisherId = String(p?.publisherId ?? p?.publisher ?? p?.clientId ?? '').trim()
      if ((payloadPublisherId && payloadPublisherId === this.publisherId) || (tagPublisherId && tagPublisherId === this.publisherId)) {
        continue
      }

      const fromContent = this.extractCellsFromEventContent(it?.event?.content)
      if (fromContent.length > 0) {
        for (const cell of fromContent) set.add(cell)
        continue
      }

      if (Array.isArray(p)) {
        for (const x of p) {
          const s = String(x ?? '').trim()
          this.addCsvCells(set, s)
        }
        continue
      }

      if (typeof p === 'string') {
        const parsed = this.extractCellsFromEventContent(p)
        if (parsed.length > 0) {
          for (const cell of parsed) set.add(cell)
        } else if (!this.looksStructuredContent(p)) {
          this.addCsvCells(set, p)
        }
        continue
      }

      const cellsArr = p?.cells ?? p?.seeds
      if (Array.isArray(cellsArr)) {
        for (const x of cellsArr) {
          const s = String(x ?? '').trim()
          this.addCsvCells(set, s)
        }
      }

      const singleCell = String(p?.cell ?? p?.seed ?? '').trim()
      this.addCsvCells(set, singleCell)
    }

    const next = Array.from(set)
    next.sort((a, b) => a.localeCompare(b))

    const sameLen = next.length === this.meshCells.length
    let same = sameLen
    if (same) {
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== this.meshCells[i]) { same = false; break }
      }
    }

    if (!same) {
      this.meshCells = next
      this.meshCellsRev++
    }
  }

  public publishExplicitCellList = async (cells: string[]): Promise<boolean> => {
    const lineage = this.resolve<any>('lineage')
    const mesh = this.tryGetMesh()
    if (!lineage || !mesh || typeof mesh.publish !== 'function') return false

    const signatureLocation = await this.computeSignatureLocation(lineage)
    if (!signatureLocation.sig) return false

    const normalized = Array.isArray(cells)
      ? cells.map(s => String(s ?? '').trim()).filter(s => s.length > 0)
      : []

    const payload = normalized.join(',')
    const ok = await mesh.publish(29010, signatureLocation.sig, payload, [['publisher', this.publisherId]])

    await this.refreshMeshCells()
    this.requestRender()

    return !!ok
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
    const explorerSegments = Array.isArray(explorerSegmentsRaw)
      ? explorerSegmentsRaw
        .map((x: unknown) => String(x ?? '').trim())
        .filter((x: string) => x.length > 0)
      : []
    const key = explorerSegments.join('/')
    return { key, sig }
  }

  // mesh discovery — resolves whichever mesh drone is registered
  // note: data queries (getNonExpired, subscribe) still use the direct API
  // coordination (ensureStartedForSig, publish) also emits effects for observability
  private tryGetMesh = (): MeshApi | null => {
    return get<MeshApi>('@diamondcoreprocessor.com/NostrMeshDrone') ?? null
  }


  private publishLocalCells = async (lineage: any, mesh: MeshApi, sig: string, grammar: string = ''): Promise<void> => {
    if (typeof mesh.publish !== 'function') return

    // Source the cell list from the current layer's children (layer-as-primitive),
    // not from an OPFS dir walk. Reads via lineage.currentLayer() — the
    // single navigation+state primitive — and resolves child sigs to
    // names via HistoryService.getLayerBySig. If neither is ready we
    // publish an empty children list (same semantic as "I'm here,
    // contributing nothing yet"); we never fall back to OPFS dirs.
    const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as {
      getLayerBySig: (s: string) => Promise<{ name?: string } | null>
    } | undefined
    let localCells: string[] = []
    if (typeof (lineage as { currentLayer?: () => Promise<unknown> })?.currentLayer === 'function' && historyService?.getLayerBySig) {
      try {
        const layer = await (lineage as { currentLayer: () => Promise<unknown> }).currentLayer()
        const childSigs = Array.isArray((layer as { children?: readonly unknown[] } | null)?.children)
          ? ((layer as { children: readonly unknown[] }).children)
          : []
        const resolved = await Promise.all(childSigs.map(async (cs) => {
          try {
            const child = await historyService.getLayerBySig(String(cs ?? ''))
            return typeof child?.name === 'string' && child.name.length > 0 ? child.name : null
          } catch { return null }
        }))
        localCells = resolved.filter((n): n is string => n !== null)
      } catch { /* keep empty */ }
    }
    const previousCells = this.lastLocalCellsBySig.get(sig) ?? []

    // 1) one snapshot post per signature: full array of items
    if (!this.snapshotPostedBySig.has(sig)) {
      await mesh.publish(29010, sig, {
        cells: localCells,
        publisherId: this.publisherId,
        mode: 'snapshot',
        publishedAtMs: Date.now()
      }, [['publisher', this.publisherId], ['mode', 'snapshot']])
      this.snapshotPostedBySig.add(sig)
      this.#lastRefreshAtMs.set(sig, Date.now())
    }

    // 2) thereafter post only newly added single items
    const prevSet = new Set(previousCells)
    for (const cell of localCells) {
      if (prevSet.has(cell)) continue
      await mesh.publish(29010, sig, cell, [['publisher', this.publisherId], ['mode', 'delta']])
    }

    this.lastLocalCellsBySig.set(sig, localCells)

    // 3) periodic refresh (lease renewal) — re-publish full cell list so late joiners see tiles
    const now = Date.now()
    const lastRefresh = this.#lastRefreshAtMs.get(sig) ?? 0
    const refreshInterval = this.#computeRefreshInterval(mesh, sig)
    if (lastRefresh > 0 && (now - lastRefresh) >= refreshInterval) {
      await mesh.publish(29010, sig, {
        cells: localCells,
        publisherId: this.publisherId,
        mode: 'refresh',
        publishedAtMs: now
      }, [['publisher', this.publisherId], ['mode', 'refresh']])
      this.#lastRefreshAtMs.set(sig, now)
    }

    const grammarCell = this.toGrammarCell(grammar)
    const grammarIsNew = grammarCell && (sig !== this.lastPublishedGrammarSig || grammarCell !== this.lastPublishedGrammarCell)
    if (grammarIsNew) {
      await mesh.publish(29010, sig, grammarCell, [['publisher', this.publisherId], ['source', 'show-honeycomb:grammar-heartbeat']])

      this.lastPublishedGrammarSig = sig
      this.lastPublishedGrammarCell = grammarCell
    }
  }

  // swarm-adaptive refresh interval: smaller swarms refresh more frequently
  #computeRefreshInterval = (mesh: MeshApi, sig: string): number => {
    const swarmSize = typeof mesh.getSwarmSize === 'function' ? mesh.getSwarmSize(sig) : 0
    const jitter = Math.floor(Math.random() * 5000)
    if (swarmSize > 20) return 90_000 + jitter
    if (swarmSize > 5) return 60_000 + jitter
    return 45_000 + jitter
  }

  // handle incoming sync-request from another publisher — republish snapshot (rate-limited)
  #handleIncomingSyncRequest = (evt: MeshEvt, mesh: MeshApi, sig: string): void => {
    if (typeof mesh.publish !== 'function') return

    const tags = evt?.event?.tags
    if (!Array.isArray(tags)) return

    // check for mode=sync-request tag
    let isSyncRequest = false
    let requestPublisherId = ''
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue
      if (String(t[0]) === 'mode' && String(t[1]) === 'sync-request') isSyncRequest = true
      if (String(t[0]) === 'publisher') requestPublisherId = String(t[1] ?? '').trim()
    }

    if (!isSyncRequest) return
    if (requestPublisherId === this.publisherId) return // ignore own sync-request

    // rate-limit: at most one triggered republish per 10s + jitter per sig
    const now = Date.now()
    const lastTriggered = this.#lastTriggeredRepublishAtMs.get(sig) ?? 0
    const cooldown = 10_000 + Math.floor(Math.random() * 3000)
    if ((now - lastTriggered) < cooldown) return

    this.#lastTriggeredRepublishAtMs.set(sig, now)

    // republish current local cells as snapshot
    const localCells = this.lastLocalCellsBySig.get(sig) ?? []
    if (localCells.length === 0) return

    void mesh.publish(29010, sig, {
      cells: localCells,
      publisherId: this.publisherId,
      mode: 'snapshot',
      publishedAtMs: now
    }, [['publisher', this.publisherId], ['mode', 'snapshot']])

    // reset refresh timer since we just published
    this.#lastRefreshAtMs.set(sig, now)
  }

  private addCsvCells = (set: Set<string>, raw: string): void => {
    const text = String(raw ?? '').trim()
    if (!text) return

    const parts = text.split(',')
    for (const part of parts) {
      const cell = String(part ?? '').trim()
      if (cell) set.add(cell)
    }
  }

  private readPublisherIdFromEvent = (evt: any): string => {
    const tags = evt?.tags
    if (!Array.isArray(tags)) return ''

    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue
      const k = String(t[0] ?? '').trim().toLowerCase()
      if (k !== 'publisher' && k !== 'p') continue

      const v = String(t[1] ?? '').trim()
      if (v) return v
    }

    return ''
  }

  private extractCellsFromEventContent = (content: any): string[] => {
    const raw = String(content ?? '').trim()
    if (!raw) return []

    // direct CSV content (preferred): "a,b,c"
    if (!raw.startsWith('{') && !raw.startsWith('[') && !raw.startsWith('"')) {
      return this.splitCsv(raw)
    }

    // JSON / structured content
    try {
      const parsed = JSON.parse(raw)

      if (typeof parsed === 'string') return this.splitCsv(parsed)

      if (Array.isArray(parsed)) {
        const out: string[] = []
        for (const x of parsed) out.push(...this.splitCsv(String(x ?? '')))
        return out
      }

      if (parsed && typeof parsed === 'object') {
        const out: string[] = []
        const cells = (parsed as any).cells ?? (parsed as any).seeds
        if (Array.isArray(cells)) {
          for (const x of cells) out.push(...this.splitCsv(String(x ?? '')))
        }

        const cell = String((parsed as any).cell ?? (parsed as any).seed ?? '').trim()
        if (cell) out.push(...this.splitCsv(cell))
        return out
      }
    } catch {
      // tolerant fallback for non-strict object-like payloads:
      // {cells:[hello2,world2],pubs:123}
      const cellsMatch = raw.match(/(?:cells|seeds)\s*:\s*\[([^\]]*)\]/i)
      if (cellsMatch && cellsMatch[1]) {
        return this.splitCsv(String(cellsMatch[1] ?? ''))
      }

      // do not split structured text blindly into junk tiles
      if (this.looksStructuredContent(raw)) return []

      // non-structured plain text fallback
      return this.splitCsv(raw)
    }

    return []
  }

  private looksStructuredContent = (raw: string): boolean => {
    const s = String(raw ?? '').trim()
    if (!s) return false
    return s.startsWith('{') || s.startsWith('[') || s.startsWith('"')
  }

  private splitCsv = (raw: string): string[] => {
    const out: string[] = []
    const parts = String(raw ?? '').split(',')
    for (const part of parts) {
      let cell = String(part ?? '').trim()
      if (cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2) {
        cell = cell.slice(1, -1).trim()
      }
      if (cell.startsWith("'") && cell.endsWith("'") && cell.length >= 2) {
        cell = cell.slice(1, -1).trim()
      }
      if (cell) out.push(cell)
    }
    return out
  }

  private toGrammarCell = (grammar: string): string => {
    const raw = String(grammar ?? '').trim()
    if (!raw) return ''
    if (raw.startsWith('show-honeycomb:')) return ''
    return raw
  }

  #renderScheduled = false

  private readonly requestRender = (): void => {
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
    const effectiveLen = this.moveNames ? this.moveNames.length : cellNames.length
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
        const cachedSig = this.cellImageCache.get(cell.label) ?? undefined
        if (cachedSig) {
          cell.imageSig = cachedSig
          if (atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) needReload.push(cell)
        } else {
          needReload.push(cell)
        }
        continue
      }
      if (this.cellImageCache.has(cell.label)) {
        const cachedSig = this.cellImageCache.get(cell.label) ?? undefined
        cell.imageSig = cachedSig
        // If the atlas evicted this sig (wrap) we must re-queue a load
        // or the shader falls back to label. Collect here, load after
        // the loop so loadCellImages handles batching + dedup.
        if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) {
          needReload.push(cell)
        }
      }
    }

    if (needReload.length > 0) {
      void (async () => {
        const lineage = this.resolve<any>('lineage')
        // dir may be null at foreign locations — loadCellImages is
        // null-tolerant and external tiles don't need a local dir.
        const dir = (await lineage?.explorerDir?.()) ?? null
        await this.loadCellImages(needReload, dir)
        this.requestRender()
      })()
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    void this.applyGeometry(cells)
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
  readonly #queueIncremental = (change: { added?: string[]; removed?: string[] }): void => {
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
  readonly #runIncrementalSync = (change: { added: string[]; removed: string[] }): void => {
    const axial = this.resolve<any>('axial')
    if (!axial?.items || !this.#slots.seeded) {
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
      return
    }

    for (const name of change.removed) {
      this.#slots.remove(name)
      this.renderedCells.delete(name)
    }

    for (const name of change.added) {
      // hasBranch defaults to false for newly-added cells (no children yet).
      // The async fill pass below will correct this if needed.
      if (!this.#slots.add(name, false)) {
        // pinned mode — LayoutService owns slot assignment, fall back to full render
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
    if (maxCells <= 0) { this.clearMesh(); return }

    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    if (cells.length === 0) { this.clearMesh(); return }

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
        const cachedSig = this.cellImageCache.get(cell.label) ?? undefined
        if (cachedSig) {
          cell.imageSig = cachedSig
          if (atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) needReload.push(cell)
        } else {
          needReload.push(cell)
        }
        continue
      }
      if (this.cellImageCache.has(cell.label)) {
        const cachedSig = this.cellImageCache.get(cell.label) ?? undefined
        cell.imageSig = cachedSig
        // atlas eviction check — if the cached sig is no longer in the
        // atlas (wrap displaced it) queue a reload. Same shape as the
        // renderIncremental path above.
        if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) {
          needReload.push(cell)
        }
      }
      const bc = this.cellBorderColorCache.get(cell.label)
      if (bc) cell.borderColor = bc
      cell.hasLink = this.cellLinkCache.get(cell.label) ?? false
      cell.hasSubstrate = this.cellSubstrateCache.get(cell.label) ?? false
      cell.hideText = this.cellHideTextCache.get(cell.label) ?? false
    }
    if (needReload.length > 0) {
      void (async () => {
        const lineage = this.resolve<any>('lineage')
        // dir may be null at foreign locations — loadCellImages is
        // null-tolerant and external tiles don't need a local dir.
        const dir = (await lineage?.explorerDir?.()) ?? null
        await this.loadCellImages(needReload, dir)
        this.requestRender()
      })()
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    this.#layerCellsCache.set(this.renderedLocationKey, {
      cells: [...cells], cellNames, localCellSet, branchSet,
    })

    // applyGeometry returns a promise but its body is synchronous for our
    // purposes; don't await — the paint happens in the next frame anyway.
    void this.applyGeometry(cells)

    // Fire-and-forget: load images and branch flags for added cells, then
    // push in-place buffer updates. Never blocks the click path.
    if (change.added.length > 0) {
      const added = change.added
      const lineage = this.resolve<any>('lineage')
      void Promise.resolve(lineage?.explorerDir?.()).then(async (dir) => {
        if (!dir) return
        // Branch flags (cheap, parallel)
        await Promise.all(added.map(async name => {
          const hasBranch = await this.checkCellHasBranch(dir, name)
          if (hasBranch) this.#slots.add(name, true)  // idempotent
        }))
        // Images + props — pushed per-cell via in-place update
        for (const name of added) {
          await this.#tryInPlaceCellUpdate(name, { dir })
        }
      }).catch(() => { /* best effort */ })
    }

    this.emitEffect('render:cell-count', this.#buildCellCountPayload(cells))
    this.#emitRenderTags(cells)
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
    if (!axial?.items || !lineage || !this.#slots.seeded) {
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
    if (maxCells <= 0) { this.clearMesh(); return }

    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    if (cells.length === 0) { this.clearMesh(); return }

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
      if (!this.cellImageCache.has(c.label)) return true
      const cachedSig = this.cellImageCache.get(c.label)
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
          const cachedSig = this.cellImageCache.get(cell.label) ?? undefined
          if (cachedSig) cell.imageSig = cachedSig
        }
        continue
      }
      if (this.cellImageCache.has(cell.label)) cell.imageSig = this.cellImageCache.get(cell.label) ?? undefined
      const bc = this.cellBorderColorCache.get(cell.label)
      if (bc) cell.borderColor = bc
      cell.hasLink = this.cellLinkCache.get(cell.label) ?? false
      cell.hasSubstrate = this.cellSubstrateCache.get(cell.label) ?? false
      cell.hideText = this.cellHideTextCache.get(cell.label) ?? false
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    this.#layerCellsCache.set(this.renderedLocationKey, {
      cells: [...cells], cellNames, localCellSet, branchSet,
    })

    await this.applyGeometry(cells)

    this.emitEffect('render:cell-count', this.#buildCellCountPayload(cells))
    this.#emitRenderTags(cells)
  }

  private readonly renderFromSynchronize = async (): Promise<void> => {
    this.shader?.setHoveredIndex(-1)
    if (!this.pixiApp || !this.pixiContainer || !this.pixiRenderer) {
      this.clearMesh()
      return
    }

    const axial = this.resolve<any>('axial')
    if (!axial?.items) {
      this.clearMesh()
      return
    }

    const lineage = this.resolve<any>('lineage')
    if (!lineage?.explorerDir || !lineage?.explorerLabel || !lineage?.changed) {
      this.clearMesh()
      return
    }

    const locationKey = String(lineage.explorerLabel?.() ?? '/')

    // fast path: skip all OPFS work when nothing has changed
    // renderedCellsKey is cleared by any invalidation event (tile:saved, orientation, clipboard, etc.)
    // #forceNextRender overrides the skip when an effect needs the next render to actually run
    // (e.g. swarm:resource-arrived firing mid-render — see the field declaration for the race details).
    if (
      !this.#forceNextRender
      && locationKey === this.renderedLocationKey
      && this.renderedCellsKey !== ''
      && !this.#clipboardView
    ) {
      return
    }
    this.#forceNextRender = false

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
      !this.#clipboardView && (
        this.#activeRenderTarget === locationKey ||
        (this.streamActive && locationKey === this.renderedLocationKey)
      )
    ) {
      return
    }

    // From here on we own the render for this target. Wrap the rest in
    // try/finally so the flag is reliably cleared even on early return
    // or throw. (The return statements throughout the body below will
    // run finally; the implicit `return` at function end too.)
    this.#activeRenderTarget = locationKey
    try {
      return await this.#renderFromSynchronizeInner(lineage, locationKey, axial)
    } finally {
      if (this.#activeRenderTarget === locationKey) this.#activeRenderTarget = null
    }
  }

  // The body of renderFromSynchronize, factored out so the dedup wrapper
  // above stays readable. All the existing logic lives here unchanged.
  readonly #renderFromSynchronizeInner = async (lineage: any, locationKey: string, axial: any): Promise<void> => {
    // Re-narrow pixi handles. The outer renderFromSynchronize already
    // guarded these but TS can't carry the narrowing across the function
    // boundary. Cheap re-check.
    if (!this.pixiApp || !this.pixiContainer || !this.pixiRenderer) {
      this.clearMesh()
      return
    }

    // note: init layer + atlases (and reset shader if renderer changes)
    if (!this.layer) {
      this.layer = new Container()
      this.pixiContainer.addChild(this.layer)

      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
      this.attachLabelResolver(this.atlas)
      this.atlas.setPivot(this.#pivot)
      if (this.#warmLabels.length) this.atlas.seed(this.#warmLabels)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 16, 16)
      this.#invalidateAllLabelDerivedState()
      this.atlasRenderer = this.pixiRenderer
      this.shader = null
    } else if (!this.atlas || this.atlasRenderer !== this.pixiRenderer) {
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
      this.attachLabelResolver(this.atlas)
      this.atlas.setPivot(this.#pivot)
      if (this.#warmLabels.length) this.atlas.seed(this.#warmLabels)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 16, 16)
      this.#invalidateAllLabelDerivedState()
      this.atlasRenderer = this.pixiRenderer
      this.shader = null
    }

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
      && !this.#clipboardView
      && !(this.#tagFlattenResults && this.#tagFlattenResults.length > 0)
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
      if (cached && cached.cells.length > 0) {
        // Capture the OUTGOING layer's live VP state into our cache so
        // a future return to that layer restores where the user actually
        // left it (pan/zoom/meshOffset they applied this session). VP's
        // OPFS write is debounced; the in-memory cache stays stale until
        // we explicitly sync it.
        this.#syncCacheFromVP(this.renderedLocationKey)
        // abort any stream still running for the previous layer
        ++this.#streamToken

        // Viewport: prefer cached snapshot (sync). If none cached AND
        // we have a dir to read from, await the OPFS read so the mesh
        // doesn't render at the previous layer's pan/zoom and snap into
        // place. For sub-layers with no on-disk dir (layer-primitive
        // model) we skip the OPFS round-trip entirely — the in-memory
        // snapshot cache is the source of truth.
        let appliedSnap: ViewportSnapshot | null = null
        const vpSnap = this.#layerViewportCache.get(locationKey)
        if (vpSnap) {
          this.#applyViewportFromSnapshot(vpSnap)
          appliedSnap = vpSnap
        } else {
          // Viewport is sig-keyed by lineage segments now (no OPFS dir
          // required), so always read — sub-layers without a dir restore
          // identically to root.
          appliedSnap = await this.#applyViewportForLayerReadSnapshot(
            cachedDir ?? null,
            lineage.explorerSegments?.() ?? [],
          )
        }
        // Explicit set — never inherit from prior render. The back-nav
        // fast path's mesh ALREADY exists, so we only need to mark
        // recenter pending; the mesh.position was already set by
        // #applyViewportFromSnapshot when snap had a meshOffset.
        this.#pendingRecenter = !appliedSnap?.meshOffset

        const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
        // Tell VP which location it's reporting to. Viewport is keyed by
        // lineage segments in the sig-keyed __viewport__ store — works for
        // sub-layers without an OPFS dir and for root (segments=[] → '/').
        vp?.setCurrentLocation?.(lineage.explorerSegments?.() ?? [])

        this.renderedLocationKey = locationKey
        this.cachedCellNames = cached.cellNames
        this.cachedLocalCellSet = cached.localCellSet
        this.cachedBranchSet = cached.branchSet
        this.#layoutMode = this.#readLayoutMode(locationKey)
        this.#pendingRemoves.clear()
        // No auto-recenter. The mesh offset was saved alongside pan/zoom
        // when the user first loaded this layer (or when they explicitly
        // ran navigation.recenter). #applyViewportFromSnapshot above
        // restored snap.meshOffset onto hexMesh.position — that's the
        // single source of truth for where the mesh sits. Only the
        // explicit recenter command (#applyCursorLayout / fitToScreen)
        // sets pendingRecenter; layer change alone does not.
        this.renderedCells.clear()

        // SYNC restore per-cell properties from per-label caches. No
        // OPFS, no atlas decode. If a cell's atlas slot was evicted
        // while we were away, mark it for background top-up.
        const atlas = this.imageAtlas
        const evictedSigs: string[] = []
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
              const sig = this.cellImageCache.get(label) ?? undefined
              if (sig) cell.imageSig = sig
            }
            if (cell.imageSig && atlas && !atlas.hasImage(cell.imageSig) && !atlas.hasFailed(cell.imageSig)) {
              evictedSigs.push(cell.imageSig)
            }
            this.renderedCells.set(label, cell)
            continue
          }
          if (this.cellImageCache.has(label)) {
            const sig = this.cellImageCache.get(label) ?? undefined
            cell.imageSig = sig
            cell.borderColor = this.cellBorderColorCache.get(label)
            cell.hasLink = this.cellLinkCache.get(label) ?? false
            cell.hasSubstrate = this.cellSubstrateCache.get(label) ?? false
            cell.hideText = this.cellHideTextCache.get(label) ?? false
            if (sig && atlas && !atlas.hasImage(sig) && !atlas.hasFailed(sig)) {
              evictedSigs.push(sig)
            }
          }
          this.renderedCells.set(label, cell)
        }

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

        this.#emitRenderTags(cached.cells)
        this.emitEffect('render:cell-count', this.#buildCellCountPayload(cached.cells))

        // Background: if any atlas slots were evicted, refill from the
        // (still-hot) Store resource cache. When new images land, the
        // shader picks them up by sig — no rerender needed. The refill
        // runs even when cachedDir is null: substrate images live in
        // __resources__ keyed by signature, so loadCellImages only needs
        // the dir for tags/link reads (already null-tolerant). Without
        // this, sub-layer tiles whose atlas slot got displaced by other
        // layers' loads while the user was away never re-paint.
        if (evictedSigs.length > 0) {
          void this.loadCellImages(cached.cells, cachedDir ?? null)
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
    const meshRev = this.meshCellsRev

    const isStale = (): boolean => {
      const currentKey = String(lineage.explorerLabel?.() ?? '/')
      const currentRev = Number(lineage.changed?.() ?? 0)
      const currentMeshRev = this.meshCellsRev
      return currentKey !== locationKey || currentRev !== fsRev || currentMeshRev !== meshRev
    }

    // Clipboard view renders from the clipboard surface, not the current
    // explorer dir. Cut tiles live in store.clipboard; copy tiles are still
    // at their sourceSegments. Fall back to explorer dir otherwise.
    let dir: FileSystemDirectoryHandle | null
    if (this.#clipboardView) {
      const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as
        { clipboard?: FileSystemDirectoryHandle; hypercombRoot?: FileSystemDirectoryHandle } | undefined
      if (this.#clipboardView.op === 'cut' && store?.clipboard) {
        dir = store.clipboard
      } else if (store?.hypercombRoot && lineage.tryResolve) {
        dir = await lineage.tryResolve(this.#clipboardView.sourceSegments, store.hypercombRoot)
        if (!dir) dir = await lineage.explorerDir()
      } else {
        dir = await lineage.explorerDir()
      }
    } else {
      // Read-only explorer dir lookup. Layer-as-primitive — hierarchy
      // lives in layer.children, not in `hypercomb.io/<path>/` folders.
      // The renderer no longer mints folders to hold viewport state;
      // viewport persistence lives keyed by lineageSig (flat), not by
      // a parallel folder tree. A null dir is the new normal for any
      // sub-layer location.
      dir = await lineage.explorerDir()
    }
    if (!this.#clipboardView && isStale()) {
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
    // When tag filter is active, use pre-scanned cross-page results instead of explorer
    if (this.#tagFlattenResults && this.#tagFlattenResults.length > 0) {
      const flatResults = this.#tagFlattenResults
      const cellNames = flatResults.map(r => r.label)
      const flatSeedSet = new Set(cellNames)

      const axial = this.resolve<any>('axial')
      if (!axial) { this.rendering = false; return }

      const maxCells = Math.min(cellNames.length, typeof axial.items.size === 'number' ? axial.items.size : cellNames.length)
      const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, flatSeedSet)
      if (cells.length === 0) { this.clearMesh(); this.rendering = false; return }

      // load images (best-effort). Runs even when dir is null —
      // loadCellImages only needs the dir for tags/link reads (already
      // null-tolerant), and EXTERNAL (peer) tiles resolve images purely
      // from the swarm's streamed sigs + __resources__. Gating on dir
      // left a witness refreshing at a foreign location (no local dir)
      // with permanently imageless tiles.
      await this.loadCellImages(cells, dir)

      this.cachedCellNames = cellNames
      this.cachedLocalCellSet = flatSeedSet
      this.cachedBranchSet = new Set()
      this.renderedCellsKey = 'tag-flatten:' + [...this.filterTags].sort().join(',')
      this.renderedLocationKey = locationKey

      this.renderedCells.clear()
      for (const cell of cells) this.renderedCells.set(cell.label, cell)
      await this.applyGeometry(cells)

      this.#emitRenderTags(cells)
      // Listeners (TileSelection, TileOverlay) crash on undefined coords
      // when payload omits them. Send the full shape via the helper.
      this.emitEffect('render:cell-count', this.#buildCellCountPayload(cells))
      this.rendering = false
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
    if (!this.#clipboardView && isStale()) {
      this.renderQueued = true
      return
    }

    // note: union with mesh cells (shared). localCells is empty at this
    // point — the layer-fill below populates `union` and `localCellSet`
    // from layer.children. Until then, only mesh-provided cells live in
    // union, which is correct: peer tiles render whether or not the
    // local layer has them.
    const union = new Set<string>()
    for (const s of this.meshCells) union.add(s)

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
    if (!this.#clipboardView && historyService) {
      const sig = await this.computeSignatureLocation(lineage)

      // Real-time supersedes preloader: cursor.load runs a bag scan +
      // warmupHistoricalResources walk that can take 600ms-1.5s on a
      // 100-marker lineage. That is preloader work for undo/redo — render
      // must NOT wait on it. Fire-and-forget so it warms in the
      // background; the user only feels its cost when they actually
      // invoke /undo or open the history viewer.
      if (cursorService && sig.sig) {
        void cursorService.load(sig.sig).catch(() => {})
      }

      if (cursorService) {
        // Primary content source: lineage.currentLayer() is memoized per
        // fsRevision and returns in <1ms from in-memory state. It IS the
        // live layer for the current location at HEAD. The cursor path
        // is only consulted when the user has actively rewound.
        let content: LayerContent | null = null
        try {
          const live = await (lineage as { currentLayer?: () => Promise<LayerContent | null> }).currentLayer?.()
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
          // Prefer cursor's currentLayerSig when it's known (it points at
          // the historical layer when rewound). Fall back to lineage's
          // live sig — important when cursor.load hasn't completed yet,
          // because without a parentLayerSig resolveChildNames skips its
          // manifest fast-path and pays per-child sig resolution.
          let parentLayerSig: string = cursorService.currentLayerSig || ''
          if (!parentLayerSig) {
            try {
              parentLayerSig = await (lineage as { currentSig?: () => Promise<string> }).currentSig?.() ?? ''
            } catch { /* leave empty */ }
          }
          layerAllowed = await resolveChildNames(historyService, parentSegments, dir, content, parentLayerSig)
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

          // Compute branchSet from the layer's sub-layers. Each entry in
          // content.children is a sig pointing to that child's layer; if
          // THAT layer has a non-empty children slot, the child is a
          // branch (clicking should drill in). Pure merkle read, no
          // OPFS walk. Errors are skipped — a child that fails to
          // resolve isn't a branch.
          const childSigs = Array.isArray(content.children) ? content.children : []
          const branchNames = new Set<string>()
          await Promise.all(childSigs.map(async (cs: unknown) => {
            try {
              const childLayer = await historyService.getLayerBySig(String(cs ?? ''))
              const subChildren = (childLayer as { children?: readonly unknown[] } | null)?.children
              if (Array.isArray(subChildren) && subChildren.length > 0) {
                const name = (childLayer as { name?: string } | null)?.name
                if (typeof name === 'string' && name.length > 0) branchNames.add(name)
              }
            } catch { /* sublayer missing — not a branch */ }
          }))
          branchSet = branchNames
        }
      }
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
    try {
      const registry = (window as any).ioc?.get?.('@hypercomb.social/TileSourceRegistry') as
        | { resolve: (loc: { segments: readonly string[]; dir: FileSystemDirectoryHandle | null }) => Promise<readonly { name: string; kind: string; source?: { peerIndex?: number } }[]> }
        | undefined
      if (registry?.resolve) {
        const segs = lineage?.explorerSegments?.() ?? []
        const entries = await registry.resolve({ segments: segs, dir })

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
            // anchors the slot. The collision check in #orderByIndexPinned
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
            // The registry entry's publisher image (canonical 0000's
            // small.image, carried by config/snapshot sources). This is
            // the SOLO image path: with no swarm running, loadOne's
            // peerTilesAtCurrentSig lookup is empty, and without this
            // map config-mounted tiles render imageless forever.
            const isig = (e.source as { imageSig?: string } | undefined)?.imageSig
            if (typeof isig === 'string' && /^[a-f0-9]{64}$/i.test(isig) && !this.registryImageByLabel.has(e.name)) {
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
    this.#ephemeralCellSet = ephemeralCellSet
    this.#peerCellSet = peerCellSet
    // Drop pubkey entries for labels that fell out of the peer set
    // (peer went stale, navigated away). Keeps the map tight; new peer
    // contributions repopulate it in the loop above.
    for (const label of [...this.#peerPubkeyByLabel.keys()]) {
      if (!peerCellSet.has(label)) this.#peerPubkeyByLabel.delete(label)
    }

    // Reconcile pendingRemoves against the layer's children list. Under
    // layer-as-primitive, the LAYER decides membership: a /remove drops
    // the cell from layer.children but leaves OPFS bytes intact (so
    // undo can restore by deleting the head history row). The check is:
    //   - in layer.children ⇒ pendingRemove is stale (undo restored it,
    //     paste landed, etc.) → drop the entry, let cell render
    //   - not in layer.children ⇒ honor the remove
    // When no layer is available (fresh lineage, clipboard view), fall
    // back to OPFS-truth — the same semantics this code shipped with.
    if (!this.#clipboardView) {
      const reconciled: string[] = []
      for (const cell of this.#pendingRemoves) {
        const presentInTruth = layerAllowed
          ? layerAllowed.has(cell)
          : localCellSet.has(cell)
        if (presentInTruth) {
          reconciled.push(cell)
        } else {
          union.delete(cell)
        }
      }
      for (const cell of reconciled) this.#pendingRemoves.delete(cell)
    }

    // filter out blocked external tiles and hidden local tiles before ordering
    const blockedSet = new Set<string>(JSON.parse(localStorage.getItem(`hc:blocked-tiles:${locationKey}`) ?? '[]'))
    for (const blocked of blockedSet) {
      if (!localCellSet.has(blocked)) union.delete(blocked)
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
    const localHidden: string[] = JSON.parse(localStorage.getItem(hideStorageKey(locationKey)) ?? '[]')
    const bareHidden: string[] = JSON.parse(localStorage.getItem(`hc:hidden-tiles:${locationKey}`) ?? '[]')
    const hiddenSet = new Set<string>([...localHidden, ...bareHidden])
    try {
      const swarm = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') as
        | { hiddenAtCurrentSig?: () => ReadonlySet<string> }
        | undefined
      const swarmHidden = swarm?.hiddenAtCurrentSig?.() ?? new Set<string>()
      for (const n of swarmHidden) hiddenSet.add(n)
    } catch { /* swarm not registered yet — local hides still apply */ }
    this.#currentHiddenSet = hiddenSet
    if (!this.#showHiddenItems) {
      for (const hidden of hiddenSet) {
        union.delete(hidden)
        ephemeralCellSet.delete(hidden)
        peerCellSet.delete(hidden)
      }
    }

    // clipboard view: show only clipboard labels
    if (this.#clipboardView) {
      const clipLabels = this.#clipboardView.labels
      for (const cell of union) {
        if (!clipLabels.has(cell)) union.delete(cell)
      }
      // Any clipboard label that didn't show up in the resolved dir is a
      // ghost — the service thinks it has a tile the filesystem can't back.
      // Emit so the worker drops it; never let the count outlive reality.
      const missing: string[] = []
      for (const label of clipLabels) {
        if (!union.has(label)) missing.push(label)
      }
      if (missing.length > 0) {
        this.emitEffect('clipboard:ghost-detected', { labels: missing })
      }
    }

    // read layout mode for this location
    this.#layoutMode = this.#readLayoutMode(locationKey)

    // resolve cell ordering through the layout mode strategy. `dir`
    // may be null when no OPFS folder mirror exists for this sub-layer;
    // pass a typed sentinel so the resolver chooses its layer-only
    // strategy instead of guarding on null shape inside the resolver.
    const cellNames = await this.#resolveCellOrder(this.#layoutMode, dir as FileSystemDirectoryHandle, union, localCellSet, lineage, peerIndices)

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

      // Viewport: prefer the in-memory snapshot (sync). MUST await the
      // OPFS read on first visit — backgrounding it caused mesh to render
      // at the previous layer's pan/zoom, then snap to the saved viewport
      // when the read landed. User saw "drift to the right/left after
      // refresh" especially on deep-link boot where the very first render
      // is the slow path.
      const vpSnap = this.#layerViewportCache.get(locationKey)
      let appliedSnap: ViewportSnapshot | null = null
      if (vpSnap) {
        this.#applyViewportFromSnapshot(vpSnap)
        appliedSnap = vpSnap
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
        this.clearMesh()
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

      // hide layer until streaming completes — prevents flash/jump during progressive render
      if (this.layer) this.layer.visible = false

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
      this.clearMesh()
      return
    }

    const wasEmpty = this.renderedCount === 0

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const maxCells = Math.min(cellNames.length, axialMax)
    if (maxCells <= 0) {
      this.clearMesh()
      return
    }

    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)
    if (cells.length === 0) {
      this.clearMesh()
      return
    }

    // note: load cell images from 0000 properties → __resources__/
    // Runs even when dir is null — loadCellImages is null-tolerant (dir
    // only feeds tags/link reads) and EXTERNAL (peer) tiles resolve
    // images from streamed sigs + __resources__ without any local dir.
    await this.loadCellImages(cells, dir)
    if (!this.#clipboardView && isStale()) {
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

    if (wasEmpty && cells.length > 0 && this.pixiApp && this.pixiContainer && this.pixiRenderer && this.#pendingRecenter) {
      // first tile on empty screen → apply 2× default ONLY when the
      // user has no saved zoom/pan for this layer. A layer with saved
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

    // Superseded before we even started (a newer renderFromSynchronize ran
    // between our void-dispatch and here). Do nothing.
    const superseded = (): boolean => myToken !== this.#streamToken

    // resolve all cell→axial positions through the single mapping function
    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const maxCells = Math.min(cellNames.length, axialMax)
    const allCells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)

    const cells: Cell[] = []
    const BATCH = ShowCellDrone.STREAM_BATCH_SIZE

    for (let start = 0; start < allCells.length; start += BATCH) {
      if (superseded()) return

      const batch = allCells.slice(start, start + BATCH)

      // load all cells in this batch in parallel — file reads + image decodes overlap
      await this.loadCellImages(batch, dir)
      if (superseded()) return

      for (const cell of batch) {
        cells.push(cell)
        this.renderedCells.set(cell.label, cell)
      }

      const isLast = start + BATCH >= allCells.length
      await this.applyGeometry(cells, isLast)
      if (superseded()) return

      // reveal the layer as soon as the first batch is on-screen so cold start
      // shows tiles immediately and the rest stream in progressively.
      if (this.layer && !this.layer.visible) {
        this.layer.visible = true
      }

      if (!isLast) await this.microDelay()
    }

    if (superseded()) return

    // safety: ensure layer is visible if loop exited without rendering anything
    if (this.layer) this.layer.visible = true

    this.streamActive = false
    this.emitEffect('navigation:guard-end', {})

    // cache for instant back-navigation. Use OUR locationKey — do not
    // read this.renderedLocationKey here; a concurrent stream could
    // have repointed it at a different layer, which would store our
    // cells under the wrong cache key and make subsequent back-nav
    // resurrect them on the wrong layer.
    if (cells.length > 0) {
      const bset = branchSet ?? new Set<string>()
      this.#layerCellsCache.set(myLocationKey, { cells: [...cells], cellNames, localCellSet, branchSet: bset })
      this.#slots.seed({ names: cellNames, localCells: localCellSet, branches: bset, mode: this.#layoutMode })
    }

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

  readonly #applyViewportForLayer = async (dir: FileSystemDirectoryHandle): Promise<boolean> => {
    // Legacy wrapper — no segments available at this call site, so it
    // falls through to the legacy `<dir>/0000` fallback. (Currently has
    // no live callers; left here for back-compat until Step 5 retires
    // the legacy path entirely.)
    const snap = await this.#applyViewportForLayerReadSnapshot(dir, null)
    return !!(snap?.zoom || snap?.pan || snap?.meshOffset)
  }

  // Same as #applyViewportForLayer but returns the snapshot itself so
  // the caller can decide whether to recenter (when there's no saved
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

    // populate back-nav fast-path cache
    const locationKey = this.renderedLocationKey
    if (locationKey) this.#layerViewportCache.set(locationKey, snap)

    this.#applyViewportFromSnapshot(snap)
    return snap
  }

  #applyViewportFromSnapshot = (snap: ViewportSnapshot): boolean => {
    const container = this.pixiContainer
    const app = this.pixiApp
    const renderer = this.pixiRenderer
    if (!container || !app || !renderer) return false

    const s = renderer.screen

    if (snap.zoom) {
      // Apply the saved scale + (cx, cy) as an approximation so the
      // initial paint isn't blank, but flag the snapshot for a refit
      // once mesh bounds are available (handled in applyGeometry).
      // Without this, a fit saved at one viewport size renders shrunk
      // and off-center after reload at a different size.
      container.scale.set(snap.zoom.scale)
      container.position.set(snap.zoom.cx, snap.zoom.cy)
      // Pan-respects-fit: refit ONLY when the saved pan is zero (or
      // absent). A non-zero saved pan means the user explicitly moved
      // away from the fit position; refitting (which calls
      // setPan(0,0)) would clobber their pan on every boot.
      const panIsZero = !snap.pan || (snap.pan.dx === 0 && snap.pan.dy === 0)
      this.#pendingFitRestore = !!snap.zoom.fit && panIsZero
    } else {
      container.scale.set(1)
      container.position.set(0, 0)
      this.#pendingFitRestore = false
    }

    if (snap.pan) {
      app.stage.position.set(s.width * 0.5 + snap.pan.dx, s.height * 0.5 + snap.pan.dy)
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
    if (snap.meshOffset) {
      if (this.hexMesh) {
        this.hexMesh.position.set(snap.meshOffset.x, snap.meshOffset.y)
        this.emitEffect('render:mesh-offset', { x: snap.meshOffset.x, y: snap.meshOffset.y })
        this.#pendingMeshOffsetRestore = null
      } else {
        this.#pendingMeshOffsetRestore = { x: snap.meshOffset.x, y: snap.meshOffset.y }
      }
    } else {
      this.#pendingMeshOffsetRestore = null
    }

    return !!(snap.zoom || snap.pan || snap.meshOffset)
  }

  private readonly applyGeometry = async (cells: Cell[], final = true): Promise<void> => {
    if (cells.length === 0) {
      this.clearMesh()
      return
    }

    const { circumRadiusPx, gapPx, padPx } = this.#hexGeo

    const nextCellsKey = this.buildCellsKey(cells)
    if (nextCellsKey === this.renderedCellsKey && cells.length === this.renderedCount) {
      return
    }

    // flat-top swaps width/height bounding box
    const hexHalfW = this.#flat ? circumRadiusPx : (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = this.#flat ? (Math.sqrt(3) * circumRadiusPx) / 2 : circumRadiusPx
    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    if (!this.atlas || !this.imageAtlas) {
      this.clearMesh()
      return
    }

    const labelTex = this.atlas.getAtlasTexture()
    const cellImageTex = this.imageAtlas.getAtlasTexture()

    for (const cell of cells) this.atlas.getLabelUV(cell.label)

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
    this.shader.setLabelMix(this.#labelsVisible ? 1.0 : 0.0)
    this.shader.setImageMix(this.#textOnly ? 0.0 : this.#substrateFadeMix())

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
      vp?.setMeshOffset?.(newX, newY)
      // Also patch the in-memory snapshot cache. Without this update,
      // next back-nav reads the old (empty) cached snap, sees no
      // meshOffset, and recomputes from bounds again — defeating the
      // whole point of saving it.
      const cached = this.#layerViewportCache.get(this.renderedLocationKey)
      if (cached) cached.meshOffset = { x: newX, y: newY }
      else this.#layerViewportCache.set(this.renderedLocationKey, { meshOffset: { x: newX, y: newY } })
      if (final) this.#pendingRecenter = false  // consumed only on final batch
    }

    // After mesh + recenter have settled on the final batch, refit if
    // the restored snapshot was a fit (snap.zoom.fit). The applied
    // (cx, cy) was an approximation derived from the previous
    // viewport's safe area — refitting against the new viewport keeps
    // content centered and not "shrunk" after a resize-then-reload.
    // Gated on `final` so partial-batch bounds don't produce a fit
    // that's too tight (would zoom in then out as more cells stream).
    if (final && this.#pendingFitRestore && this.hexMesh?.getLocalBounds) {
      this.#pendingFitRestore = false
      const zoom = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ZoomDrone') as { zoomToFit?: (snap?: boolean) => void } | undefined
      zoom?.zoomToFit?.(true)
    }

    this.geom = geom
    this.renderedCellsKey = nextCellsKey
    this.renderedCount = cells.length

    // rebuild reverse axial lookup for O(1) tile:hover
    this.#axialToIndex.clear()
    for (let i = 0; i < cells.length; i++) {
      this.#axialToIndex.set(`${cells[i].q},${cells[i].r}`, i)
    }
    this.emitEffect('render:cell-count', this.#buildCellCountPayload(cells))
    this.#emitRenderTags(cells)
  }

  /** Emit render:tags with unique tag names + counts from all currently visible cells. */
  #emitRenderTags(cells: Cell[]): void {
    const counts = new Map<string, number>()
    for (const cell of cells) {
      const tags = this.cellTagsCache.get(cell.label)
      if (tags) {
        for (const tag of tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1)
        }
      }
    }
    const tags = [...counts.entries()].map(([name, count]) => ({ name, count }))
    this.emitEffect('render:tags', { tags })
  }

  /** Tag scanning across directory tree removed — no-op. */
  async #scanTagsAcrossPages(): Promise<void> {
    // directory-based tag scanning removed
  }

  // 1–3ms micro-pause to avoid main-thread blocking (legacy JsonHiveStreamLoader pattern)
  private readonly microDelay = (): Promise<void> =>
    new Promise(r => setTimeout(r, 1 + Math.random() * 2))

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
    window.addEventListener('synchronize', this.requestRender)
    window.addEventListener('navigate', this.requestRender)

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
    lineage?.addEventListener('change', this.onLineageChange)

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
    this.onEffect<{ cell: string }>('tile:saved', (payload) => {
      if (payload?.cell) {
        const oldSig = this.cellImageCache.get(payload.cell)
        this.cellImageCache.delete(payload.cell)
        this.cellBorderColorCache.delete(payload.cell)
        this.cellTagsCache.delete(payload.cell)
        this.cellLinkCache.delete(payload.cell)
        this.cellSubstrateCache.delete(payload.cell)
        this.cellHideTextCache.delete(payload.cell)
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

    // tags:changed — invalidate only the affected cells' tag caches, then run
    // an incremental render to re-emit tag state without touching geometry I/O.
    this.onEffect<{ updates: { cell: string }[] }>('tags:changed', (payload) => {
      if (!payload?.updates) return
      const changedCells: string[] = []
      for (const { cell } of payload.updates) {
        this.cellTagsCache.delete(cell)
        changedCells.push(cell)
      }
      if (this.cachedCellNames && changedCells.length > 0) {
        void this.renderIncremental({ changedTags: changedCells })
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey)
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    // fs:changed — bulk OPFS mutation marker. Workers fire this BEFORE
    // committing layer state so that any render triggered by the cascade
    // (cursor.onNewLayer) sees post-mutation OPFS. We use it here to
    // unconditionally drop our caches and re-render — the mutation is a
    // signal that listCellFolders must refetch and the slot machine state
    // is stale (positions may shift, new tiles may have appeared).
    this.onEffect('fs:changed', () => {
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.#slots.clear()
      this.requestRender()
    })

    // cell:added / cell:removed — synchronous incremental path. Zero awaits
    // in the click handler. The slot state machine mutates immediately, the
    // next microtask runs one applyGeometry, and images for new cells are
    // loaded fire-and-forget afterward. Rapid clicks in one JS turn coalesce
    // into a single render.
    this.onEffect<{ cell: string; groupId?: string }>('cell:added', (payload) => {
      if (!payload?.cell) return
      this.#pendingRemoves.delete(payload.cell)
      this.#startNewCellFade(payload.cell)
      if (this.#slots.seeded) {
        this.#queueIncremental({ added: [payload.cell] })
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey)
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    this.onEffect<{ cell: string; groupId?: string }>('cell:removed', (payload) => {
      if (!payload?.cell) return
      this.#pendingRemoves.add(payload.cell)
      this.cellImageCache.delete(payload.cell)
      this.cellTagsCache.delete(payload.cell)
      this.cellLinkCache.delete(payload.cell)
      this.cellBorderColorCache.delete(payload.cell)
      this.cellSubstrateCache.delete(payload.cell)
      this.cellHideTextCache.delete(payload.cell)
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
      this.#invalidateAllLabelDerivedState()
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
      // Apply the layer's layout state (text-only, orientation, pivot,
      // gap, mode) so every cursor step restores the full visible
      // configuration. Fires on both rewound and head — at head the
      // layer mirrors live state because every user intent commits, so
      // applying head is a no-op modulo redundant emits.
      void this.#applyCursorLayout()
      // Actually trigger the re-render. Without this, clicking a row
      // in the history viewer (which calls cursor.seek → emits
      // history:cursor-changed) clears the caches but doesn't paint
      // the new state. renderFromSynchronize re-reads the cursor and
      // produces the historical view at the new position.
      void this.renderFromSynchronize()

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
    this.onEffect<{ keyword: string }>('search:filter', ({ keyword }) => {
      this.filterKeyword = String(keyword ?? '').trim().toLowerCase()
      this.requestRender()
    })

    // tags:filter effect — cross-page tag flatten
    this.onEffect<{ active: string[] }>('tags:filter', ({ active }) => {
      const wasFiltering = this.filterTags.size > 0
      this.filterTags = new Set(active)
      if (this.filterTags.size > 0) {
        // Save location before entering filter mode
        if (!wasFiltering) {
          const lineage = this.resolve<any>('lineage')
          this.#preFilterSegments = lineage?.explorerSegments?.() ? [...lineage.explorerSegments()] : []
        }
        void this.#scanTagsAcrossPages()
      } else {
        this.#tagFlattenResults = null
        this.renderedCellsKey = ''
        // Restore previous location
        if (this.#preFilterSegments !== null) {
          const nav = get('@hypercomb.social/Navigation') as { goRaw?: (segs: string[]) => void } | undefined
          nav?.goRaw?.(this.#preFilterSegments)
          this.#preFilterSegments = null
        }
        this.requestRender()
      }
    })

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
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.pixiApp = payload.app
      this.pixiContainer = payload.container
      this.pixiRenderer = payload.renderer
      this.requestRender()
    })

    // listen for orientation change
    this.onEffect<{ flat: boolean }>('render:set-orientation', (payload) => {
      if (this.#flat !== payload.flat) {
        this.#flat = payload.flat
        // invalidate image cache since we need different snapshots
        this.cellImageCache.clear()
        this.#layerCellsCache.clear()
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

    // listen for space (room) and secret changes — recompute signature
    this.onEffect<{ room: string }>('mesh:room', ({ room }) => {
      if (this.#space !== room) {
        this.#space = room
        this.renderedLocationKey = ''
        this.requestRender()
      }
    })

    this.onEffect<{ secret: string }>('mesh:secret', ({ secret }) => {
      if (this.#secret !== secret) {
        this.#secret = secret
        this.renderedLocationKey = ''
        this.requestRender()
      }
    })

    // clipboard:view effect — filter visible cells to clipboard contents
    this.onEffect<{ active: boolean; labels?: string[]; sourceSegments?: string[]; op?: 'cut' | 'copy' }>('clipboard:view', (payload) => {
      const wasActive = this.#clipboardView
      if (payload?.active && payload.labels) {
        this.#clipboardView = {
          labels: new Set(payload.labels),
          sourceSegments: payload.sourceSegments ?? [],
          op: payload.op ?? 'copy',
        }
        // Entering clipboard view: make sure the mesh layer is visible.
        // A prior cancelled stream may have left it hidden — clipboard view
        // doesn't go through the layer-change branch that normally restores
        // visibility, so we do it explicitly here.
        if (this.layer) this.layer.visible = true
      } else {
        this.#clipboardView = null
      }
      this.renderedCellsKey = '' // force full geometry rebuild on enter/exit

      // Exiting clipboard view: drop caches for the clipboard labels (they
      // were populated from store.clipboard / sourceSegments and may not
      // match the real explorer layer), and reset the transient slot + pending
      // remove state so the next explorer render rebuilds cleanly without
      // inheriting clipboard-era layout or ghost-remove entries.
      if (wasActive && !payload?.active) {
        for (const label of wasActive.labels) {
          this.cellImageCache.delete(label)
          this.cellBorderColorCache.delete(label)
          this.cellTagsCache.delete(label)
          this.cellLinkCache.delete(label)
          this.cellSubstrateCache.delete(label)
          this.cellHideTextCache.delete(label)
        }
        this.#slots.clear()
        this.#pendingRemoves.clear()
        if (this.layer) this.layer.visible = true
      }
      this.requestRender()
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

    // locale:changed — flush label atlas so all tile labels re-resolve through i18n
    this.onEffect<{ locale: string }>('locale:changed', () => {
      if (this.atlas) {
        this.atlas.invalidateLabels()
      }
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // labels:invalidated — fresh translations registered for current locale; re-resolve atlas.
    this.onEffect<{ locale: string }>('labels:invalidated', () => {
      if (this.atlas) {
        this.atlas.invalidateLabels()
      }
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // cell from persisted stores so secret/room survive page reload
    const roomStore = get<any>('@hypercomb.social/RoomStore')
    const secretStore = get<any>('@hypercomb.social/SecretStore')
    if (roomStore?.value && this.#space !== roomStore.value) {
      this.#space = roomStore.value
      this.renderedLocationKey = ''
    }
    if (secretStore?.value && this.#secret !== secretStore.value) {
      this.#secret = secretStore.value
      this.renderedLocationKey = ''
    }

    // listen for public/private toggle — clear mesh cells when going private so
    // external tiles disappear immediately without requiring a manual refresh
    this.onEffect<{ public: boolean }>('mesh:public-changed', ({ public: isPublic }) => {
      if (!isPublic) {
        this.meshCells = []
        this.meshCellsRev++
      }
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
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
      this.renderedCellsKey = ''
      const locationKey = this.renderedLocationKey
      this.renderedLocationKey = ''
      if (locationKey) this.#layerCellsCache.delete(locationKey)
      this.requestRender()
    })

    // Spotlight changes — a peer's layer was surfaced (or dismissed
    // back to merged). Update the cached pubkey and invalidate the
    // render cache so the next pass re-runs the borderColor path with
    // the new spotlight state. Cheap: same layer-cells data, just a
    // different borderColor computation per cell.
    this.onEffect<{ activePeer: string | null }>('spotlight:changed', (payload) => {
      this.#spotlightPubkey = payload?.activePeer ?? null
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // Location change — different lineage means different cell set;
    // the session slot cache is keyed by label and the new cells may
    // share names with the old ones (rare but possible at deep
    // navigations). Wipe the cache on every lineage change to keep
    // slot assignments scoped per location.
    this.onEffect('fs:changed', () => {
      // fs:changed fires on navigation as well as data mutations;
      // gating on locationKey change keeps it cheap.
      const lineage = this.resolve<any>('lineage')
      const here = String(lineage?.explorerLabel?.() ?? '/')
      if (here !== this.renderedLocationKey) {
        this.#sessionSlotByLabel.clear()
      }
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
        this.cellSubstrateCache.delete(payload.cell)
        if (!done && this.#slots.seeded) {
          this.cellImageCache.delete(payload.cell)
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
        for (const [label, cached] of this.cellImageCache) {
          if (cached === sig || cached === null) {
            this.cellImageCache.delete(label)
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

    // substrate:rerolled — user rerolled a single tile's substrate. Same
    // per-cell change shape as substrate:applied; same routing and same
    // deferred-invalidation discipline.
    this.onEffect<{ cell: string }>('substrate:rerolled', (payload) => {
      if (!payload?.cell) return
      void this.#tryInPlaceCellUpdate(payload.cell, { dir: null }).then(done => {
        this.cellSubstrateCache.delete(payload.cell)
        if (!done && this.#slots.seeded) {
          this.cellImageCache.delete(payload.cell)
          void this.renderIncremental({ changedContent: [payload.cell] })
        }
      })
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

    this.onEffect<{ cell: string; index: number }>('cell:place-at', (payload) => {
      void this.#handlePlaceAt(payload.cell, payload.index)
    })

    this.onEffect<{ labels: string[] }>('cell:reorder', (payload) => {
      void this.#handleReorder(payload.labels)
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

    this.onEffect<{ q: number; r: number }>('tile:hover', (payload) => {
      if (!this.shader) return
      const idx = this.#axialToIndex.get(`${payload.q},${payload.r}`)
      this.shader.setHoveredIndex(idx ?? -1)

      // Emit hovered tile's tags for UI highlight
      let hoverTags: string[] = []
      for (const [label, cell] of this.renderedCells) {
        if (cell.q === payload.q && cell.r === payload.r) {
          hoverTags = this.cellTagsCache.get(label) ?? []
          break
        }
      }
      this.emitEffect('tile:hover-tags', { tags: hoverTags })
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
      publishCells: async (cells: string[]) => this.publishExplicitCellList(cells),
      signature: async () => {
        const lineage = this.resolve<any>('lineage')
        return await this.computeSignatureLocation(lineage)
      }
    }
  }

  /**
   * Apply the layer's layout state to the live renderer. Called on every
   * cursor move (undo/redo/seek) so the visible configuration always
   * matches the layer at the current cursor position. At head this is a
   * no-op because every user intent commits and the live state already
   * matches — we still run it for symmetry so returning to head after a
   * rewound view restores whatever the layout was at head.
   *
   * Emits absolute-value events so the rest of the system (LayerCommitter,
   * atlases, shader subscribers) stays in lock-step. commitLayer dedupes
   * identical layouts, so redundant emits do not grow history.
   *
   * Fields with default-equivalent values in older layers (empty string,
   * zero gap) are skipped so legacy entries do not regress the live view
   * — the "crunched tiles" regression happened when historical layers
   * without populated layout were applied verbatim.
   */
  /**
   * Drop every label-keyed derived-state cache in one call. These six
   * maps are views of the same identity (facts derived from a
   * propsSig), so invalidation always happens together. Centralising
   * the clear keeps the cursor-change and explorer-ready paths from
   * having to list each map individually.
   */
  #invalidateAllLabelDerivedState = (): void => {
    this.cellImageCache.clear()
    this.cellBorderColorCache.clear()
    this.cellTagsCache.clear()
    this.cellLinkCache.clear()
    this.cellSubstrateCache.clear()
    this.cellHideTextCache.clear()
  }

  // Layout reconstruction was layer-driven via `content.layoutSig`.
  // The slim layer doesn't carry that field — layout is the live
  // bee's own state, owned by the layout drone, not embedded in
  // the lineage's history snapshot. If past-layout playback is
  // wanted, the layout bee should commit its own per-state
  // primitive (its own array of properties) and a reader should
  // ask THAT primitive at the cursor's position.
  #applyCursorLayout = async (): Promise<void> => { /* no-op under slim layer */ }

  protected override dispose = (): void => {
    window.removeEventListener('synchronize', this.requestRender)
    window.removeEventListener('navigate', this.requestRender)

    if (this.#newCellFadeRaf) {
      cancelAnimationFrame(this.#newCellFadeRaf)
      this.#newCellFadeRaf = 0
    }
    this.#newCellFadeStart.clear()

    if (this.lineageChangeListening) {
      const lineage = this.resolve<EventTarget>('lineage')
      lineage?.removeEventListener('change', this.onLineageChange)
      this.lineageChangeListening = false
    }
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

  private clearMesh = (): void => {
    if (this.hexMesh && this.layer) {
      // Capture the centering offset before destroying the mesh so the
      // next mesh (e.g. when redo brings tiles back from empty) can
      // restore it instead of starting at (0,0).
      this.#lastMeshOffset = { x: this.hexMesh.position.x, y: this.hexMesh.position.y }
      try { this.layer.removeChild(this.hexMesh as any) } catch { /* ignore */ }
      try { this.hexMesh.destroy?.(true) } catch { /* ignore */ }
    }

    if (this.geom) {
      try { this.geom.destroy(true) } catch { /* ignore */ }
    }

    this.hexMesh = null
    this.geom = null
    this.renderedCellsKey = ''
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
    this.emitEffect('render:cell-count', this.#buildCellCountPayload([]))
  }

  /**
   * Attach the i18n label resolver to the label atlas so cell directory names
   * are rendered as localized display text when a translation is registered.
   */
  private readonly attachLabelResolver = (atlas: HexLabelAtlas): void => {
    const i18n = get<I18nProvider>(I18N_IOC_KEY)
    if (i18n) {
      atlas.setLabelResolver((directoryName: string) => i18n.resolveCell(directoryName))
    }
  }

  private readonly rebuildRenderResources = (renderer: unknown): void => {
    this.clearMesh()
    this.shader = null
    this.atlas = new HexLabelAtlas(renderer, 128, 8, 8)
    this.attachLabelResolver(this.atlas)
    this.imageAtlas = new HexImageAtlas(renderer, 256, 16, 16)
    this.cellImageCache.clear()
    this.atlasRenderer = renderer
  }

  // Per-revision cache. Multiple callers per nav ask for the same dir's
  // children; the OPFS scan is the same answer until lineage's #fsRevision
  // listCellFolders retired: tile membership is read exclusively from
  // the current layer's children slot via history.currentLayerAt +
  // history.getLayerBySig. The OPFS hierarchy at hypercomb.io/<tile>/
  // is no longer the source of truth for tile lists.

  // Per-revision branch detection cache. checkCellHasBranch is one OPFS
  // getDirectoryHandle + entries() iteration per cell — for an N-tile
  // layer (root often has the most), every full render redid N+ OPFS
  // calls even though nothing in the dir changed. WeakMap on the dir
  // handle, keyed by lineage revision so any user FS mutation (which
  // calls lineage.invalidate) busts the cache automatically. In-flight
  // dedup mirrors listCellFolders so concurrent renders share one walk.
  readonly #branchSetCache = new WeakMap<FileSystemDirectoryHandle, { revision: number; result: Set<string> }>()
  readonly #branchSetPending = new WeakMap<FileSystemDirectoryHandle, { revision: number; promise: Promise<Set<string>> }>()

  #computeBranchSet = async (dir: FileSystemDirectoryHandle, localCells: readonly string[]): Promise<Set<string>> => {
    const lineage = this.resolve<any>('lineage')
    const revision = Number(lineage?.changed?.() ?? 0)

    const cached = this.#branchSetCache.get(dir)
    if (cached?.revision === revision) return cached.result

    const pending = this.#branchSetPending.get(dir)
    if (pending?.revision === revision) return pending.promise

    const promise = (async (): Promise<Set<string>> => {
      const out = new Set<string>()
      await Promise.all(localCells.map(async (name) => {
        if (await this.checkCellHasBranch(dir, name)) out.add(name)
      }))
      if (Number(lineage?.changed?.() ?? 0) === revision) {
        this.#branchSetCache.set(dir, { revision, result: out })
      }
      return out
    })()

    this.#branchSetPending.set(dir, { revision, promise })
    promise.finally(() => {
      const p = this.#branchSetPending.get(dir)
      if (p?.promise === promise) this.#branchSetPending.delete(dir)
    })

    return promise
  }

  // Single source of truth for the render:cell-count payload. Listeners
  // (TileSelectionDrone, TileOverlayDrone, etc.) read coords[i],
  // branchLabels, externalLabels, etc. — emitting a stripped payload
  // makes them store undefined and throw on the next access. Keep every
  // emit going through this helper so back-nav fast path, tag-flatten,
  // streaming, and incremental paths all send identical shapes.
  #buildCellCountPayload(cells: readonly Cell[]): {
    count: number
    labels: string[]
    coords: { q: number; r: number }[]
    branchLabels: string[]
    externalLabels: string[]
    noImageLabels: string[]
    substrateLabels: string[]
    linkLabels: string[]
    hiddenLabels: string[]
  } {
    // Peer tiles get marked as branches so tile-overlay routes their
    // clicks through #navigateInto (URL changes, lineage updates, swarm
    // re-subscribes). Without this they fall through to the editor's
    // 'open' action and the user can't browse a peer's tree.
    return {
      count: cells.length,
      labels: cells.map(c => c.label),
      coords: cells.map(c => ({ q: c.q, r: c.r })),
      branchLabels: cells.filter(c => c.hasBranch || this.#peerCellSet.has(c.label)).map(c => c.label),
      externalLabels: cells.filter(c => c.external).map(c => c.label),
      noImageLabels: cells.filter(c => !c.imageSig).map(c => c.label),
      substrateLabels: cells.filter(c => c.hasSubstrate).map(c => c.label),
      linkLabels: cells.filter(c => c.hasLink).map(c => c.label),
      hiddenLabels: this.#showHiddenItems ? [...this.#currentHiddenSet] : [],
    }
  }

  #layoutModeKey(locationKey: string): string {
    return `hc:layout-mode:${locationKey}`
  }

  #readLayoutMode(_locationKey: string): 'dense' | 'pinned' {
    // Pinned is the canonical default: each cell keeps its slot index
    // permanently (stored in its 0000 properties). The spiral/contiguous
    // fill runs only once — to assign an index to a brand-new cell that
    // has none yet. Removal leaves a gap, never shifts neighbours.
    return 'pinned'
  }

  #persistLayoutMode(mode: 'dense' | 'pinned'): void {
    const lineage = this.resolve<any>('lineage')
    const locationKey = String(lineage?.explorerLabel?.() ?? '/')
    localStorage.setItem(this.#layoutModeKey(locationKey), mode)
  }

  async #orderByIndexPinned(dir: FileSystemDirectoryHandle, names: string[], localCellSet: Set<string>, readOnly = false, peerIndices?: Map<string, number>): Promise<string[]> {
    const axial = this.resolve<any>('axial')
    const maxSlot = axial?.count ?? 60
    const sparse: string[] = new Array(maxSlot + 1).fill('')

    let nextFree = 0
    const unindexed: string[] = []

    // IndexNurse owns the index read path — layer-slot first, 0000
    // fallback (the legacy path; consulted only when the layer carries
    // no properties yet). Caches per cell; invalidates on
    // `cell:0000-changed` broadcast (both writeTilePropertiesAt and
    // writeCellProperties emit it). Cold misses fall through to either
    // the layer's properties slot or the 0000 file; warm reads are
    // constant-time. Registered eagerly in side-effects.
    const indexNurse = (window as any).ioc?.get?.('@diamondcoreprocessor.com/IndexNurse') as
      | { read: (parentSegments: readonly string[], cellName: string, cellDir?: FileSystemDirectoryHandle, cacheKey?: string) => Promise<number | undefined> }
      | undefined

    // Cache key is the cell's lineage signature, never its bare folder
    // name. Two cells in different parent folders can share a leaf
    // name (a "Notes" tile is common at many depths) and a name-keyed
    // cache returns the first-seen index for every subsequent read of
    // the same leaf — which on cold-load-at-subfolder + nav-back
    // resolves to the SUBFOLDER's index, collides with the parent's
    // real occupant, demotes the loser to unindexed, and persists it
    // to slot 0. The lineage signature is unique per location and the
    // same address inflate uses, so the in-memory cache, the on-disk
    // 0000.index, and the inflate tree all agree on which cell is
    // which.
    const lineage = this.resolve<any>('lineage')
    const parentSegments: readonly string[] = lineage?.explorerSegments?.() ?? []

    // Pass 1 — place LOCAL indexed cells first so they own their persisted
    // slots before any peer-published index gets a chance to claim them.
    // Peer tiles deferred to Pass 2 below.
    const peerNames: string[] = []
    for (const name of names) {
      if (!localCellSet.has(name)) {
        peerNames.push(name)
        continue
      }
      try {
        // Layer-slot read with 0000 fallback. cellDir is opportunistic
        // — the dir may not exist for layer-only tiles, in which case
        // getDirectoryHandle throws and we still read from the layer.
        let cellDir: FileSystemDirectoryHandle | undefined
        try { cellDir = await dir.getDirectoryHandle(name, { create: false }) } catch { /* layer-only tile */ }
        const cacheKey = await cellLocationSig(parentSegments, name)
        const idx = indexNurse
          ? await indexNurse.read(parentSegments, name, cellDir, cacheKey)
          : await readTilePropertiesAt(parentSegments, name).then(p =>
              typeof p['index'] === 'number' ? (p['index'] as number) : undefined,
            )
        if (typeof idx === 'number') {
          if (idx >= 0 && idx <= maxSlot) {
            // collision detection: if slot is already occupied, demote to unindexed
            if (sparse[idx] !== '') {
              unindexed.push(name)
            } else {
              sparse[idx] = name
            }
          } else {
            unindexed.push(name)
          }
        } else {
          unindexed.push(name)
        }
      } catch {
        unindexed.push(name)
      }
    }

    // Pass 2 — peer tiles. Honor the publisher's `index` when the
    // matching slot is free locally; otherwise demote to the unindexed
    // pile and let the score-based fill below pick a slot.
    //
    // Why honor it: when the receiver has no conflicting local tile at
    // the published index, using it preserves the visual identity the
    // publisher set (a tile at "their" slot 3 sits at slot 3 on every
    // receiver who has slot 3 free). On a fresh incognito canvas with
    // zero local tiles every peer index lands clean — exactly the
    // scenario the user called out: "there are most certainly no
    // indexes in the way with zero initial tiles."
    //
    // Why the collision check is enough: Pass 1 (above) has already
    // claimed every slot a local indexed tile owns. If a peer index
    // collides with one of those, sparse[peerIdx] !== '' and we fall
    // through to the unindexed queue. So local layout stays sovereign;
    // peer indices are only respected on otherwise-empty slots.
    //
    // Deterministic peer order: sort peer names before placement so
    // multi-peer rendering is stable across reruns and freshness
    // rotation. Without this, two peers republishing the same name
    // with different indices could flip the surviving slot every
    // render based on Map-iteration order.
    peerNames.sort((a, b) => a.localeCompare(b))
    for (const name of peerNames) {
      const peerIdx = peerIndices?.get(name)
      if (typeof peerIdx === 'number' && peerIdx >= 0 && peerIdx <= maxSlot && sparse[peerIdx] === '') {
        sparse[peerIdx] = name
      } else {
        unindexed.push(name)
      }
    }

    // Sort the unindexed pile alphabetically before the score-based
    // fill below. Same determinism reason: scoreMap is deterministic
    // (slots evaluate identically given the same viewport), so the
    // ONLY non-deterministic input is the iteration order of unindexed
    // — sort it and the whole layout becomes reproducible across
    // renders. Local-without-index and peers share the queue at this
    // point; both classes are stable name-keyed, which is what the
    // user-spec wants.
    unindexed.sort((a, b) => a.localeCompare(b))

    // Place unindexed cells by scoring every empty slot on three
    // factors and picking the minimum:
    //
    //   1. off          — how far off-screen, in screen-fractions
    //                     (0 if the slot is on-screen). From the
    //                     CenterSlotTracker, refreshed passively
    //                     whenever the viewport changes.
    //   2. -whitespace  — negated count of empty/off-grid neighbours
    //                     so that more whitespace (better fit) sorts
    //                     before crowded slots. Computed here against
    //                     the current sparse[] since occupancy is
    //                     transient render state.
    //   3. center       — squared screen-fraction distance from screen
    //                     center, aspect-aware tiebreaker.
    //
    // Falls back to the lowest free slot if neither the tracker nor
    // axial adjacency is available (very early boot).
    const slotTracker = (window as any).ioc?.get?.('@diamondcoreprocessor.com/CenterSlotTracker') as
      | { scores: ReadonlyMap<number, { off: number; center: number }> }
      | undefined
    const axialAny = (window as any).ioc?.get?.('@diamondcoreprocessor.com/AxialService') as
      | { Adjacents: Map<number, { index: number }[]> }
      | undefined
    const scoreMap = slotTracker?.scores
    const adjacents = axialAny?.Adjacents

    for (const name of unindexed) {
      // Session-cache short-circuit. If this tile was already placed
      // in a prior render (local-no-index path during persistence
      // race, or any peer tile) and the slot is still free, drop it
      // back into the same slot. Pans don't change cached assignments;
      // only manual reorganize clears this map.
      const cachedSlot = this.#sessionSlotByLabel.get(name)
      if (typeof cachedSlot === 'number' && cachedSlot >= 0 && cachedSlot <= maxSlot && sparse[cachedSlot] === '') {
        sparse[cachedSlot] = name
        // Persist on every cache hit too — first-write may have failed
        // silently (storage cold, committer queue full, race with cell
        // commit), leaving the tile indexless in the layer. Retrying
        // on cache hit makes the repair eventually-consistent:
        // writeTilePropertiesAt is content-addressed and idempotent on
        // identical bytes, so once one write succeeds the layer has
        // the index permanently and future renders go through Pass 1
        // directly without ever touching this loop.
        if (!readOnly && localCellSet.has(name)) {
          void writeTilePropertiesAt(parentSegments, name, { index: cachedSlot }).catch(err =>
            console.warn('[show-cell] index persist retry failed for', name, err)
          )
        }
        continue
      }

      let placed = -1

      if (scoreMap && adjacents) {
        let bestOff = Infinity
        let bestWhitespace = -1
        let bestCenter = Infinity
        for (let i = 0; i <= maxSlot; i++) {
          if (sparse[i] !== '') continue
          const s = scoreMap.get(i)
          if (!s) continue
          // Count neighbours that aren't occupied tiles — off-grid
          // neighbours at the rim of the grid count as whitespace
          // because the visual area beyond the grid edge is empty.
          let whitespace = 0
          const neighbours = adjacents.get(i) ?? []
          for (const adj of neighbours) {
            const ai = adj.index
            if (!Number.isFinite(ai) || ai < 0 || ai > maxSlot || sparse[ai] === '') whitespace++
          }
          if (
            s.off < bestOff ||
            (s.off === bestOff && whitespace > bestWhitespace) ||
            (s.off === bestOff && whitespace === bestWhitespace && s.center < bestCenter)
          ) {
            bestOff = s.off
            bestWhitespace = whitespace
            bestCenter = s.center
            placed = i
          }
        }
      }

      // Lowest-free fallback — only if scoring couldn't find anything
      // (tracker/adjacency missing, or grid genuinely full above).
      if (placed < 0) {
        while (nextFree <= maxSlot && sparse[nextFree] !== '') nextFree++
        if (nextFree > maxSlot) continue
        placed = nextFree
        nextFree++
      }

      sparse[placed] = name
      // Cache the assignment so subsequent renders skip the score
      // recomputation. Same memory cell whether this is a local tile
      // awaiting persistence or a peer tile that won't ever persist
      // here. Stable across pan, viewport change, freshness rotation.
      this.#sessionSlotByLabel.set(name, placed)
      if (!readOnly && localCellSet.has(name)) {
        // Fire-and-forget — the session cache provides intra-render
        // stability regardless of when persistence completes, and the
        // cache-hit branch above retries persistence on every later
        // render until one write succeeds. So we don't need to await
        // here; awaiting just blocks the placement loop for no
        // synchronization benefit.
        void writeTilePropertiesAt(parentSegments, name, { index: placed }).catch(err =>
          console.warn('[show-cell] failed to persist index for', name, err)
        )
      }
    }


    return sparse
  }

  /**
   * Central ordering strategy — all render paths route through here.
   * Pinned is the only mode: each cell sits at its persisted `index`
   * slot, gaps are preserved, and collision is resolved by moving the
   * loser to the next free slot (persisted on write). Returns a sparse
   * array where cellNames[i] → axial position i, with empty-string
   * entries marking unoccupied slots.
   */
  async #resolveCellOrder(
    _mode: string,
    dir: FileSystemDirectoryHandle,
    union: Set<string>,
    localCellSet: Set<string>,
    _lineage: any,
    peerIndices?: Map<string, number>,
  ): Promise<string[]> {
    // Clipboard view is a preview surface — pack cells contiguously from
    // slot 0 so they render near the viewport origin regardless of whatever
    // slot index they happened to hold in their source layer.
    if (this.#clipboardView) {
      return [...union].sort((a, b) => a.localeCompare(b))
    }

    // When cursor is rewound, use cursor-aware ordering so deletions
    // that happened later don't leave stale slot indices in OPFS
    // overlapping the rewound cell set.
    const cursor = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as
      HistoryCursorService | undefined
    const isRewound = cursor?.state?.rewound ?? false

    let cellNames: string[]
    if (isRewound && cursor) {
      const content = await cursor.layerContentAtCursor()
      // Resolve child sigs → names by enumerating parent dir +
      // matching against each child's bag markers. Falls back to
      // live disk ordering when the past layer can't be resolved.
      const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
      const parentSegments = (_lineage as { explorerSegments?: () => readonly string[] })?.explorerSegments?.() ?? []
      const orderedNames = (content && historyService)
        ? [...await resolveChildNames(historyService, parentSegments, dir, content)]
        : []
      if (orderedNames.length > 0) {
        const unionSet = new Set(union)
        const filtered = orderedNames.filter(s => unionSet.has(s))
        for (const s of union) {
          if (!filtered.includes(s)) filtered.push(s)
        }
        // Slot index is the cell's stable visual position. Even when
        // rewound, place each cell at its persisted `index` so x/y/scale
        // don't shift across undo — only membership (which slots are
        // occupied) changes between history points. readOnly: rewound
        // viewing must not mutate disk indices.
        cellNames = await this.#orderByIndexPinned(dir, filtered, localCellSet, true, peerIndices)
      } else {
        cellNames = await this.#orderByIndexPinned(dir, Array.from(union), localCellSet, false, peerIndices)
      }
    } else {
      cellNames = await this.#orderByIndexPinned(dir, Array.from(union), localCellSet, false, peerIndices)
    }

    if (this.filterKeyword) {
      const kw = this.filterKeyword
      cellNames = cellNames.map(s => s && s.toLowerCase().includes(kw) ? s : '')
    }
    return cellNames
  }

  // #orderByIndex (dense-packed) removed — pinned is the only layout
  // mode. #orderByIndexPinned handles index assignment, collision
  // detection, and next-available-slot fallback in one pass.

  async #handlePlaceAt(cell: string, targetIndex: number): Promise<void> {
    // Index is the source of truth. Place this one cell at the target
    // index — do not renumber anyone else. Render-time collision heal
    // (in #orderByIndexPinned) demotes any prior occupant to the next
    // free slot.
    const lineage = this.resolve<any>('lineage')
    if (!lineage) return

    const parentSegments: readonly string[] = lineage?.explorerSegments?.() ?? []
    try {
      await writeTilePropertiesAt(parentSegments, cell, { index: targetIndex })
    } catch (err) {
      console.warn('[show-cell] place-at failed for', cell, err)
    }

    this.renderedCellsKey = ''
    this.#layerCellsCache.clear()
    this.requestRender()
  }

  async #handleReorder(_labels: string[]): Promise<void> {
    // Cell index is the source of truth — written per-cell by the move
    // drone (and similar). This handler only invalidates the renderer's
    // caches so the next pass re-reads the persisted indices. It MUST
    // NOT renumber indices densely — that was the snap-back bug.
    this.renderedCellsKey = ''
    this.#layerCellsCache.clear()
    this.requestRender()
  }

  private checkCellHasBranch = async (parentDir: FileSystemDirectoryHandle, cellName: string): Promise<boolean> => {
    try {
      const cellDir = await parentDir.getDirectoryHandle(cellName, { create: false })
      for await (const [name, handle] of cellDir.entries()) {
        if (handle.kind === 'directory' && !name.startsWith('__')) return true
      }
    } catch { /* cell doesn't exist or can't be read */ }
    return false
  }

  private buildCellsFromAxial = (axial: any, names: string[], max: number, localCellSet: Set<string>, branchSet?: Set<string>): Cell[] => {
    const out: Cell[] = []
    // during move drag, use reordered names so labels map to correct indices
    const effectiveNames = this.moveNames ?? names

    for (let i = 0; i < max; i++) {
      const a = axial.items.get(i) as Axial | undefined
      const label = effectiveNames[i] ?? names[i]
      if (!a) break
      if (!label) continue

      const div = this.#divergenceFutureAdds.has(label) ? 1 : this.#divergenceFutureRemoves.has(label) ? 2 : 0
      out.push({ q: a.q, r: a.r, label, external: !localCellSet.has(label), heat: this.#heatByLabel.get(label) ?? 0, hasBranch: branchSet?.has(label) ?? false, divergence: div })
    }

    return out
  }

  /**
   * Load cell properties from the content-addressed tile-props index
   * and resolve the small.image signature from __resources__/ into the image atlas.
   * Standard: any property value matching a 64-char hex signature
   * refers to a blob in __resources__/{signature}.
   */
  private loadCellImages = async (
    cells: Cell[],
    _dir: FileSystemDirectoryHandle | null,
    forceReload?: Set<string>,
  ): Promise<void> => {
    const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as
      { getResource: (sig: string) => Promise<Blob | null> } | undefined
    if (!store || !this.imageAtlas) return
    const imageAtlas = this.imageAtlas

    const livePropsIndex: Record<string, string> = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')
    // When cursor is rewound and we have content-state overrides, use those
    const propsIndex = this.#cursorPropsOverride
      ? Object.fromEntries([...Object.entries(livePropsIndex), ...this.#cursorPropsOverride])
      : livePropsIndex

    // Peer-published image sigs for tiles the user hasn't adopted yet.
    // For each peer-only tile (kind:'peer', `cell.external === true`),
    // the SwarmDrone may have streamed an imageSig — the publisher's
    // substrate-cache pointer — which now lives in OPFS via the
    // resource-pull pipeline. Looking it up here lets the image-load
    // path treat the peer's sig as if it were a local propsIndex entry
    // and render the publisher's image as a preview before the user
    // commits to adopt.
    const peerImageSigByLabel = new Map<string, string>()
    try {
      const swarm = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') as
        | { peerTilesAtCurrentSig?: () => readonly { name: string; imageSig?: string }[] }
        | undefined
      const peerTiles = swarm?.peerTilesAtCurrentSig?.() ?? []
      for (const t of peerTiles) {
        if (typeof t.imageSig === 'string' && !peerImageSigByLabel.has(t.name)) {
          peerImageSigByLabel.set(t.name, t.imageSig)
        }
      }
    } catch { /* swarm not registered yet — no peer previews */ }

    // Per-batch dedup so cells sharing an image (e.g. substrate fills) only fetch + decode once
    const inFlightImages = new Map<string, Promise<void>>()
    const loadImageOnce = (sig: string): Promise<void> => {
      if (imageAtlas.hasImage(sig) || imageAtlas.hasFailed(sig)) return Promise.resolve()
      const existing = inFlightImages.get(sig)
      if (existing) return existing
      const promise = (async () => {
        try {
          const blob = await store.getResource(sig)
          if (!blob) return
          await imageAtlas.loadImage(sig, blob)
        } catch { /* per-cell warnings removed — fired on every nav */ }
      })()
      inFlightImages.set(sig, promise)
      return promise
    }

    const loadOne = async (cell: Cell): Promise<void> => {
      // External cells (kind:'peer' from the SwarmDrone) have no local
      // OPFS dir, so the OPFS-based
      // tags/link/substrate reads further down would always throw. The
      // peer path has its OWN content-addressed image source though:
      // the swarm streamed the publisher's `imageSig` and the bytes are
      // already in __resources__/. Resolve it the same way local cells
      // do (propsBlob → small.image → imageAtlas), then return without
      // touching the OPFS-only caches.
      if (cell.external) {
        // Peer-only tiles render ONLY the publisher's streamed image — the
        // sig is content-addressed and the publisher is the authority, so
        // the CURRENT peerImageSigByLabel value always wins. The cache is a
        // derivation memo, valid only while its SOURCE sig is unchanged
        // (peerImageSourceByLabel) — without that check, a stale or
        // cross-contaminated entry pinned peer tiles to WRONG images
        // forever (the witness showed shuffled/random tiles even though
        // the wire carried the exact right sigs per name).
        // No local-pool fallback in any branch: painting the receiver's
        // substrate pick on a tile the receiver doesn't own is wrong.
        // LIVE publisher sig first (swarm visuals); REGISTRY entry sig as
        // the solo fallback — config-mounted tiles (DCP-adopted branches)
        // have no live publisher, their canonical image rides the
        // TileSourceRegistry entry instead. Both are publisher-derived
        // from the same canonical 0000, so either is exact.
        const peerSig = peerImageSigByLabel.get(cell.label)
          ?? this.registryImageByLabel.get(cell.label)
        if (peerSig) {
          const cached = this.cellImageCache.get(cell.label)
          if (cached && this.peerImageSourceByLabel.get(cell.label) === peerSig) {
            cell.imageSig = cached
            return
          }
          try {
            const blob = await store.getResource(peerSig)
            if (!blob) { this.cellImageCache.set(cell.label, null); return }
            // The wire has carried two shapes: a PROPS pointer (JSON blob
            // whose small.image holds the image sig — the old substrate-
            // cache pointer) and the DIRECT image sig (current visuals
            // inline the canonical 0000, whose small.image IS the image).
            // Parse-as-JSON distinguishes them: parseable → derive; binary
            // → the sig is the image itself.
            let finalSig: string | null = null
            try {
              const props = JSON.parse(await blob.text())
              const smallSig = (this.#flat && props?.flat?.small?.image) || props?.small?.image
              if (smallSig && isSignature(smallSig)) finalSig = smallSig
            } catch {
              finalSig = peerSig
            }
            if (finalSig) {
              await loadImageOnce(finalSig)
              cell.imageSig = finalSig
              this.cellImageCache.set(cell.label, finalSig)
              this.peerImageSourceByLabel.set(cell.label, peerSig)
            } else {
              this.cellImageCache.set(cell.label, null)
            }
          } catch {
            this.cellImageCache.set(cell.label, null)
          }
          return
        }
        // No CURRENT peer sig (bytes/visual not arrived this pass): reuse a
        // previously-derived value if one exists — re-render passes must not
        // strand the tile — otherwise mark null and wait for the next
        // visuals/resource arrival to re-attempt.
        const cached = this.cellImageCache.get(cell.label)
        if (cached) { cell.imageSig = cached; return }
        this.cellImageCache.set(cell.label, null)
        return
      }

      // load tags + link from OPFS if not cached (independent of image cache).
      // Sub-layer locations have no on-disk dir under layer-as-primitive; the
      // image path below still resolves via __resources__, so we just skip
      // the tags/link folder read when _dir is null.
      if (!this.cellTagsCache.has(cell.label)) {
        if (_dir) {
          try {
            const cellDir = await _dir.getDirectoryHandle(cell.label)
            const tagProps = await readCellProperties(cellDir)
            const rawTags = tagProps?.['tags']
            this.cellTagsCache.set(cell.label, Array.isArray(rawTags)
              ? (rawTags as unknown[]).filter((t): t is string => typeof t === 'string')
              : [])
            if (!this.cellLinkCache.has(cell.label)) {
              this.cellLinkCache.set(cell.label, typeof tagProps?.['link'] === 'string' && (tagProps['link'] as string).length > 0)
            }
          } catch { this.cellTagsCache.set(cell.label, []) }
        } else {
          this.cellTagsCache.set(cell.label, [])
        }
      }

      // check cache first — unless the caller forced a reload for this
      // label (substrate:applied / substrate:rerolled just wrote a new
      // propsSig and we need to re-read props instead of serving the
      // stale cached sig).
      if (!forceReload?.has(cell.label) && this.cellImageCache.has(cell.label)) {
        const cachedSig = this.cellImageCache.get(cell.label) ?? undefined
        cell.imageSig = cachedSig
        cell.borderColor = this.cellBorderColorCache.get(cell.label)
        cell.hasLink = this.cellLinkCache.get(cell.label) ?? false
        cell.hasSubstrate = this.cellSubstrateCache.get(cell.label) ?? false
        cell.hideText = this.cellHideTextCache.get(cell.label) ?? false
        // If the atlas has since evicted this signature (a later
        // loadImage displaced its slot), re-queue a load so the
        // render doesn't fall back to label. The blob is almost
        // certainly in the resource cache, so this is cheap.
        if (cachedSig) {
          if (!imageAtlas.hasImage(cachedSig) && !imageAtlas.hasFailed(cachedSig)) {
            await loadImageOnce(cachedSig)
          }
        } else {
          // cache entry is null — first visit resolved no image. This is
          // the commonest failure shape: substrate hadn't yet assigned
          // a propsSig when loadOne first ran, null got cached, and no
          // later path retries. Fall through to the slow path so we
          // re-read propsIndex in case substrate has since populated
          // it.
          this.cellImageCache.delete(cell.label)
        }
        if (this.cellImageCache.has(cell.label)) return
      }

      // read tile properties from content-addressed resource
      try {
        const propsSig = propsIndex[cell.label]
        if (!propsSig) throw new Error('no props')
        const blob = await store.getResource(propsSig)
        if (!blob) throw new Error('no blob')
        const text = await blob.text()
        const props = JSON.parse(text)

        // extract border color from properties
        const bc = props?.border?.color
        if (bc && typeof bc === 'string' && /^#?[0-9a-fA-F]{6}$/.test(bc.replace('#', ''))) {
          const hex = bc.startsWith('#') ? bc : `#${bc}`
          const r = parseInt(hex.slice(1, 3), 16) / 255
          const g = parseInt(hex.slice(3, 5), 16) / 255
          const b = parseInt(hex.slice(5, 7), 16) / 255
          cell.borderColor = [r, g, b]
          this.cellBorderColorCache.set(cell.label, [r, g, b])
        }

        // extract tags from properties
        const cellTags = props?.['tags']
        if (Array.isArray(cellTags)) {
          this.cellTagsCache.set(cell.label, cellTags.filter((t: unknown) => typeof t === 'string'))
        } else {
          this.cellTagsCache.set(cell.label, [])
        }

        // extract link presence
        const hasLink = typeof props?.link === 'string' && props.link.length > 0
        this.cellLinkCache.set(cell.label, hasLink)
        cell.hasLink = hasLink

        const isSubstrate = props?.substrate === true
        this.cellSubstrateCache.set(cell.label, isSubstrate)
        cell.hasSubstrate = isSubstrate

        const hideText = props?.hideText === true
        this.cellHideTextCache.set(cell.label, hideText)
        cell.hideText = hideText

        const smallSig = (this.#flat && props?.flat?.small?.image) || props?.small?.image
        if (smallSig && isSignature(smallSig)) {
          // Load atlas FIRST, then publish the new sig to the cache.
          // Any concurrent render observing `cellImageCache` during the
          // await sees the previous entry (stale-but-valid) rather than
          // a missing one. The cache transitions from old → new
          // atomically, and by the time it does, the atlas already
          // holds the new image.
          await loadImageOnce(smallSig)
          cell.imageSig = smallSig
          this.cellImageCache.set(cell.label, smallSig)
        } else {
          // No image on this tile's persistent props (commonly label-only
          // tiles with viewport state). Ask substrate for a deterministic
          // per-label fallback so the tile shows a background instead of
          // empty. Does NOT mutate the user's props — only sets the
          // display-time imageSig.
          const subSvc = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SubstrateService') as
            { pickImageForLabel?: (label: string) => string | null } | undefined
          const fallbackSig = subSvc?.pickImageForLabel?.(cell.label) ?? null
          if (fallbackSig && isSignature(fallbackSig)) {
            await loadImageOnce(fallbackSig)
            cell.imageSig = fallbackSig
            this.cellImageCache.set(cell.label, fallbackSig)
          } else {
            this.cellImageCache.set(cell.label, null)
          }
        }
      } catch {
        // no cell dir or no properties file — no image
        this.cellImageCache.set(cell.label, null)
      }
    }

    await Promise.all(cells.map(loadOne))
  }

  private buildCellsKey = (cells: Cell[]): string => {
    const selectionService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SelectionService') as
      { isSelected: (label: string) => boolean } | undefined
    // Fold the atlas's eviction generation into the key. Baked UVs
    // in the geometry buffer become stale whenever an atlas slot is
    // reused by a different sig — same imageSig on a cell does NOT
    // imply the same UV if the atlas has evicted and re-loaded it.
    // Including the generation forces a rebuild in exactly the cases
    // where it's needed (and only those).
    const atlasGen = this.imageAtlas?.evictionGeneration ?? 0
    let s = `p${this.#pivot ? 1 : 0}f${this.#flat ? 1 : 0}g${atlasGen}|`
    for (const c of cells) s += `${c.q},${c.r}:${c.label}:${c.external ? 1 : 0}:${c.imageSig ?? ''}:${c.hasBranch ? 1 : 0}:${c.divergence ?? 0}:${c.hideText ? 1 : 0}|`
    return s
  }

  private axialToPixel = (q: number, r: number, s: number, flat = false) => flat
    ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
    : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }

  private buildFillQuadGeometry(cells: Cell[], r: number, gap: number, hw: number, hh: number): Geometry {
    const spacing = r + gap

    const selectionService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SelectionService') as
      { isSelected: (label: string) => boolean } | undefined

    const pos = new Float32Array(cells.length * 8)
    const uv = new Float32Array(cells.length * 8)
    const labelUV = new Float32Array(cells.length * 16)
    const imageUV = new Float32Array(cells.length * 16)
    const hasImage = new Float32Array(cells.length * 4)
    const heat = new Float32Array(cells.length * 4)
    const identityColor = new Float32Array(cells.length * 12)
    const branch = new Float32Array(cells.length * 4)
    const borderColor = new Float32Array(cells.length * 12)
    const cellIndex = new Float32Array(cells.length * 4)
    const divergence = new Float32Array(cells.length * 4)
    const idx = new Uint32Array(cells.length * 6)

    let pv = 0, uvp = 0, luvp = 0, iuvp = 0, hip = 0, hp = 0, icp = 0, bp = 0, bcp = 0, cip = 0, dp = 0, ii = 0, base = 0
    let ci = 0

    for (const c of cells) {
      const { x, y } = this.axialToPixel(c.q, c.r, spacing, this.#flat)

      const x0 = x - hw, x1 = x + hw
      const y0 = y - hh, y1 = y + hh

      pos.set([x0, y0, x1, y0, x1, y1, x0, y1], pv)
      pv += 8

      uv.set([0, 0, 1, 0, 1, 1, 0, 1], uvp)
      uvp += 8

      const imgUV = c.imageSig ? this.imageAtlas?.getImageUV(c.imageSig) ?? null : null

      // label UV: collapse to [0,0,0,0] when hideText + image present so the
      // shader samples a transparent corner and the label is effectively hidden.
      const ruv = (c.hideText && imgUV) ? { u0: 0, v0: 0, u1: 0, v1: 0 } : this.atlas!.getLabelUV(c.label)
      for (let i = 0; i < 4; i++) {
        labelUV.set([ruv.u0, ruv.v0, ruv.u1, ruv.v1], luvp)
        luvp += 4
      }

      const hi = imgUV ? 1 : 0
      for (let i = 0; i < 4; i++) {
        imageUV.set(imgUV ? [imgUV.u0, imgUV.v0, imgUV.u1, imgUV.v1] : [0, 0, 0, 0], iuvp)
        iuvp += 4
      }
      hasImage.set([hi, hi, hi, hi], hip)
      hip += 4

      const h = c.heat ?? 0
      heat.set([h, h, h, h], hp)
      hp += 4

      let [cr, cg, cb] = labelToRgb(c.label)
      // gray out hidden items when show-hidden is active
      const isHiddenItem = this.#showHiddenItems && this.#currentHiddenSet.has(c.label)
      if (isHiddenItem) {
        const gray = cr * 0.3 + cg * 0.3 + cb * 0.3
        cr = gray * 0.5; cg = gray * 0.5; cb = gray * 0.5
      }
      identityColor.set([cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb], icp)
      icp += 12

      const b = c.hasBranch ? 1 : 0
      branch.set([b, b, b, b], bp)
      bp += 4

      let [bcr, bcg, bcb] = c.borderColor ?? [0.784, 0.592, 0.353]
      if (isHiddenItem) {
        const bgray = bcr * 0.3 + bcg * 0.3 + bcb * 0.3
        bcr = bgray * 0.5; bcg = bgray * 0.5; bcb = bgray * 0.5
      }
      // Group accent for peer tiles — every peer-contributed tile gets
      // the publisher's deterministic pubkey-derived color as its
      // border, ALWAYS (not just in spotlight mode). Each contributor
      // is visually identifiable at a glance: Alice's tiles glow one
      // hue, Bob's another. Same labelToRgb hash used for label-based
      // identity colors, just keyed on pubkey — uniform "identity
      // color" architecture across own tiles and peer groups.
      //
      // Spotlight emphasis: when a peer's layer is surfaced via the
      // layer-cycle strip / alt+scroll, their tiles render at full
      // brightness; other peer groups dim slightly so the active layer
      // pops without losing the rest. Own tiles keep their normal
      // borderColor (label or substrate-derived).
      const cellPubkey = this.#peerPubkeyByLabel.get(c.label)
      if (cellPubkey) {
        const [pr, pg, pb] = labelToRgb(cellPubkey)
        const brightness = this.#spotlightPubkey === null
          ? 0.85                                          // no spotlight — all groups at uniform group brightness
          : (this.#spotlightPubkey === cellPubkey ? 1.0   // this peer is active — full intensity
            : 0.45)                                       // other peer — recede so the active group pops
        bcr = pr * brightness
        bcg = pg * brightness
        bcb = pb * brightness
      }
      borderColor.set([bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb], bcp)
      bcp += 12

      cellIndex.set([ci, ci, ci, ci], cip)
      cip += 4
      ci++

      const dv = c.divergence ?? 0
      divergence.set([dv, dv, dv, dv], dp)
      dp += 4

      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], ii)
      ii += 6
      base += 4
    }

    const g = new Geometry()
      ; (g as any).addAttribute('aPosition', pos, 2)
      ; (g as any).addAttribute('aUV', uv, 2)
      ; (g as any).addAttribute('aLabelUV', labelUV, 4)
      ; (g as any).addAttribute('aImageUV', imageUV, 4)
      ; (g as any).addAttribute('aHasImage', hasImage, 1)
      ; (g as any).addAttribute('aHeat', heat, 1)
      ; (g as any).addAttribute('aIdentityColor', identityColor, 3)
      ; (g as any).addAttribute('aHasBranch', branch, 1)
      ; (g as any).addAttribute('aBorderColor', borderColor, 3)
      ; (g as any).addAttribute('aCellIndex', cellIndex, 1)
      ; (g as any).addAttribute('aDivergence', divergence, 1)
      ; (g as any).addIndex(idx)

    // save buffer references + label→index map so tile:saved can push
    // in-place attribute updates to the GPU without rebuilding geometry
    this.#buf = { pos, labelUV, imageUV, hasImage, heat, identityColor, branch, borderColor, divergence }
    this.#labelToIndex.clear()
    for (let i = 0; i < cells.length; i++) this.#labelToIndex.set(cells[i].label, i)

    return g
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

    const sig = this.cellImageCache.get(label) ?? null
    const imgUV = sig ? (this.imageAtlas.getImageUV(sig) ?? null) : null

    if (imgUV) {
      this.#writeCellVec4(imageUV, i, imgUV.u0, imgUV.v0, imgUV.u1, imgUV.v1)
    } else {
      this.#writeCellVec4(imageUV, i, 0, 0, 0, 0)
    }
    this.#writeCellScalar(hasImage, i, imgUV ? 1 : 0)

    const [bcr, bcg, bcb] = this.cellBorderColorCache.get(label) ?? [0.784, 0.592, 0.353]
    this.#writeCellRgb(borderColor, i, bcr, bcg, bcb)

    // labelUV: collapse to origin when hideText + image so the label is hidden
    const ht = this.cellHideTextCache.get(label) ?? false
    if (ht && imgUV) {
      this.#writeCellVec4(labelUV, i, 0, 0, 0, 0)
    } else {
      const ruv = this.atlas.getLabelUV(label)
      this.#writeCellVec4(labelUV, i, ruv.u0, ruv.v0, ruv.u1, ruv.v1)
    }

    if (!this.#pushBuffer('aImageUV') || !this.#pushBuffer('aHasImage') || !this.#pushBuffer('aBorderColor') || !this.#pushBuffer('aLabelUV')) {
      return false
    }

    const rec = this.renderedCells.get(label)
    if (rec) {
      rec.imageSig = sig ?? undefined
      rec.borderColor = [bcr, bcg, bcb]
      rec.hasLink = this.cellLinkCache.get(label) ?? false
      rec.hasSubstrate = this.cellSubstrateCache.get(label) ?? false
      rec.hideText = ht
      const cellsSnapshot = [...this.renderedCells.values()]
      this.renderedCellsKey = this.buildCellsKey(cellsSnapshot)
    }

    this.#emitRenderTags([...this.renderedCells.values()])
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
const showCell = new ShowCellDrone()
window.ioc.register('@diamondcoreprocessor.com/ShowCellDrone', showCell)
console.log('[hypercomb] show-cell: pendingRecenter no longer leaks across layer changes; mesh.position and overlay #meshOffset stay in sync (2026-05-07n)')