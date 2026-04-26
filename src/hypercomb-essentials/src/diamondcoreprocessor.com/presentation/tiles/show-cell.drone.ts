// diamondcoreprocessor.com/pixi/show-cell.drone.ts
import { Drone, SignatureService, SignatureStore, I18N_IOC_KEY } from '@hypercomb/core'
import type { I18nProvider } from '@hypercomb/core'
import { Application, Container, Geometry, Mesh, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { HexLabelAtlas } from '../grid/hex-label.atlas.js'
import { HexImageAtlas } from '../grid/hex-image.atlas.js'
import { HexSdfTextureShader } from '../grid/hex-sdf.shader.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY, createHexGeometry } from '../grid/hex-geometry.js'
import { isSignature, readCellProperties, writeCellProperties } from '../../editor/tile-properties.js'
import type { HistoryService } from '../../history/history.service.js'
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
  parentDir: FileSystemDirectoryHandle | null,
  content: { children?: string[] } | null,
): Promise<Set<string>> {
  const out = new Set<string>()
  if (!content?.children?.length) return out
  const wanted = new Set(content.children)

  // Pre-warm preloader for every on-disk child name. seedSigFor caches
  // the sig→bytes mapping so getLayerBySig becomes O(1) below. This is
  // the "load by signature" path: every parent.children sig is now
  // resolvable from memory without any further OPFS work.
  if (parentDir) {
    for await (const [childName, handle] of (parentDir as any).entries()) {
      if (handle.kind !== 'directory') continue
      await history.seedSigFor(childName)
    }
  }

  // One mechanical pass: lookup each parent.children sig via preloader.
  // Hot cache for bagless children (warmed above) and for committed
  // children (warmed at commit time). No cold-walk in the steady state.
  for (const childSig of content.children) {
    if (!wanted.has(childSig)) continue
    const child = await history.getLayerBySig(childSig)
    if (child?.name) out.add(child.name)
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

  protected override listens = ['render:host-ready', 'mesh:ready', 'mesh:items-updated', 'tile:saved', 'search:filter', 'render:set-orientation', 'render:set-pivot', 'mesh:room', 'mesh:secret', 'cell:place-at', 'cell:reorder', 'render:set-gap', 'move:preview', 'clipboard:captured', 'layout:mode', 'tags:changed', 'tags:filter', 'history:cursor-changed', 'tile:toggle-text', 'visibility:show-hidden', 'overlay:neon-color', 'translation:tile-start', 'translation:tile-done', 'locale:changed', 'substrate:changed', 'substrate:ready', 'substrate:applied', 'substrate:rerolled', 'cell:added', 'cell:removed']
  protected override emits = ['mesh:ensure-started', 'mesh:subscribe', 'mesh:publish', 'render:mesh-offset', 'render:cell-count', 'render:geometry-changed', 'render:tags', 'tile:hover-tags']
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private atlas: HexLabelAtlas | null = null
  private imageAtlas: HexImageAtlas | null = null
  private atlasRenderer: unknown = null

  // cache: cell label → small image signature (avoids re-reading 0000 on every render)
  private readonly cellImageCache = new Map<string, string | null>()
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
  private suppressMeshRecenter = false
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
      console.log('[show-honeycomb] signature location', signatureLocation.key)
      console.log('[show-honeycomb] nak command (copy from window.__showHoneycombNakCommand):', nakCmd)
    }

    if (!sig) return

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
  #cachedSigLocationKey: string | null = null
  #cachedSigLocation: { key: string; sig: string } = { key: '', sig: '' }

  private computeSignatureLocation = async (lineage: any): Promise<{ key: string; sig: string }> => {
    const explorerSegmentsRaw = lineage?.explorerSegments?.()
    const explorerSegments = Array.isArray(explorerSegmentsRaw)
      ? explorerSegmentsRaw
        .map((x: unknown) => String(x ?? '').trim())
        .filter((x: string) => x.length > 0)
      : []

    // Bag identity = ancestry only. No domain (display namespace, not
    // identity). No room/secret (mesh-layer concerns; they shift with
    // peer credentials but the local bag is the location, you're
    // already there). Must match HistoryService.sign().
    const key = explorerSegments.join('/')

    // fast path: return cached result if key hasn't changed (and we've
    // actually computed at least once — null sentinel above guards the
    // first call from a placeholder hit).
    if (this.#cachedSigLocationKey !== null && key === this.#cachedSigLocationKey) return this.#cachedSigLocation

    // use SignatureStore.signText() for memoization — same lineage path = same sig
    const sigStore = get<SignatureStore>('@hypercomb/SignatureStore')
    const sig = sigStore
      ? await sigStore.signText(key)
      : await SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer)

    this.#cachedSigLocationKey = key
    this.#cachedSigLocation = { key, sig }
    return this.#cachedSigLocation
  }

  // mesh discovery — resolves whichever mesh drone is registered
  // note: data queries (getNonExpired, subscribe) still use the direct API
  // coordination (ensureStartedForSig, publish) also emits effects for observability
  private tryGetMesh = (): MeshApi | null => {
    return get<MeshApi>('@diamondcoreprocessor.com/NostrMeshDrone') ?? null
  }


  private publishLocalCells = async (lineage: any, mesh: MeshApi, sig: string, grammar: string = ''): Promise<void> => {
    if (typeof mesh.publish !== 'function') return
    if (!lineage?.explorerDir) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    const localCells = await this.listCellFolders(dir)
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
        const dir = await lineage?.explorerDir?.()
        if (!dir) return
        await this.loadCellImages(needReload, dir)
        this.requestRender()
      })()
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    this.suppressMeshRecenter = true
    void this.applyGeometry(cells).finally(() => { this.suppressMeshRecenter = false })
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
      if (cell.external) continue
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
        const dir = await lineage?.explorerDir?.()
        if (!dir) return
        await this.loadCellImages(needReload, dir)
        this.requestRender()
      })()
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    this.#layerCellsCache.set(this.renderedLocationKey, {
      cells: [...cells], cellNames, localCellSet, branchSet,
    })

    this.suppressMeshRecenter = true
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

    this.emitEffect('render:cell-count', {
      count: cells.length,
      labels: cells.map(cell => cell.label),
      coords: cells.map(cell => ({ q: cell.q, r: cell.r })),
      branchLabels: cells.filter(cell => cell.hasBranch).map(cell => cell.label),
      externalLabels: cells.filter(cell => cell.external).map(cell => cell.label),
      noImageLabels: cells.filter(cell => !cell.imageSig).map(cell => cell.label),
      substrateLabels: cells.filter(cell => cell.hasSubstrate).map(cell => cell.label),
      linkLabels: cells.filter(cell => cell.hasLink).map(cell => cell.label),
      hiddenLabels: this.#showHiddenItems ? [...this.#currentHiddenSet] : [],
    })
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
      if (cell.external) continue
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

    this.suppressMeshRecenter = true
    await this.applyGeometry(cells)

    this.emitEffect('render:cell-count', {
      count: cells.length,
      labels: cells.map(cell => cell.label),
      coords: cells.map(cell => ({ q: cell.q, r: cell.r })),
      branchLabels: cells.filter(cell => cell.hasBranch).map(cell => cell.label),
      externalLabels: cells.filter(cell => cell.external).map(cell => cell.label),
      noImageLabels: cells.filter(cell => !cell.imageSig).map(cell => cell.label),
      substrateLabels: cells.filter(cell => cell.hasSubstrate).map(cell => cell.label),
      linkLabels: cells.filter(cell => cell.hasLink).map(cell => cell.label),
      hiddenLabels: this.#showHiddenItems ? [...this.#currentHiddenSet] : [],
    })
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
    if (locationKey === this.renderedLocationKey && this.renderedCellsKey !== '' && !this.#clipboardView) {
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
      dir = await lineage.explorerDir()
    }
    if (!this.#clipboardView && isStale()) {
      this.renderQueued = true
      return
    }
    if (!dir) {
      console.warn('[show-honeycomb] BAIL: explorerDir returned null')
      this.clearMesh()
      return
    }
    // populate back-nav fast-path dir cache
    this.#layerDirCache.set(locationKey, dir)

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

      // load images from the first matching dir (best-effort)
      await this.loadCellImages(cells, dir!)

      this.cachedCellNames = cellNames
      this.cachedLocalCellSet = flatSeedSet
      this.cachedBranchSet = new Set()
      this.renderedCellsKey = 'tag-flatten:' + [...this.filterTags].sort().join(',')
      this.renderedLocationKey = locationKey

      this.renderedCells.clear()
      for (const cell of cells) this.renderedCells.set(cell.label, cell)
      await this.applyGeometry(cells)

      this.#emitRenderTags(cells)
      this.emitEffect('render:cell-count', { count: cells.length, labels: cellNames })
      this.rendering = false
      return
    }

    // note: cell collection — always fresh, never cached
    const localCells = await this.listCellFolders(dir)
    if (!this.#clipboardView && isStale()) {
      this.renderQueued = true
      return
    }

    // note: union with mesh cells (shared)
    const union = new Set<string>()
    for (const s of localCells) union.add(s)
    for (const s of this.meshCells) union.add(s)

    const localCellSet = new Set(localCells)

    // detect which local cells have children (branches)
    const branchSet = new Set<string>()
    await Promise.all(localCells.map(async (name) => {
      if (await this.checkCellHasBranch(dir, name)) branchSet.add(name)
    }))

    // note: apply history — filter out cells whose last operation is "remove"
    // When a cursor is rewound, also compute divergence (future adds/removes)
    // Skip when clipboard view is active — clipboard labels are authoritative
    const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    const cursorService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
    this.#divergenceFutureAdds = new Set<string>()
    this.#divergenceFutureRemoves = new Set<string>()
    this.#cursorPropsOverride = null
    this.#cursorReconstructionKey = ''
    if (!this.#clipboardView && historyService) {
      const sig = await this.computeSignatureLocation(lineage)

      // Load cursor for this location (keeps cursor position if already set)
      if (cursorService) await cursorService.load(sig.sig)

      // Layer drives the cell set. When the cursor has a layer at this
      // position, intersect union with it AND import any layer cells
      // missing from disk (so historical cells render even after their
      // OPFS dirs are gone).
      //
      // When there is NO layer at all (fresh lineage, no commits yet),
      // fall through with `union` = live disk cells. The committer
      // mints a baseline on the first user event; until then live
      // disk is the sensible default — refusing to render leaves the
      // user with a blank canvas and no obvious recovery path.
      if (cursorService) {
        const content = await cursorService.layerContentAtCursor()
        const cursorState = cursorService.state

        // Two distinct null-content cases:
        //
        //   (A) Bag has markers, user undone past them → position 0,
        //       cursor.layerContentAtCursor returns null. Render empty
        //       (synthetic "pre-history" view).
        //
        //   (B) Bag has no markers at all (fresh lineage, sig migration
        //       orphaned old bags, etc.) → also position 0, also null.
        //       Fall through to live OPFS so tiles display from disk.
        //
        // Distinguish by total: total > 0 means "history exists, you're
        // before it" (case A). total === 0 means "no history" (case B).
        if (!content && cursorState?.position === 0 && (cursorState?.total ?? 0) > 0) {
          union.clear()
          localCellSet.clear()
        }

        if (content) {
          // At HEAD: on-disk listing IS the truth (just-committed layer
          // matches it by construction). Don't touch union — preserve
          // every tile and its slot index. This keeps "no auto-arrange":
          // typing a new tile never displaces an existing one.
          //
          // REWOUND: load by signature. The past layer's children sigs
          // are the authoritative cell set; resolve each via preloader
          // and replace union so live-disk tiles that didn't exist at
          // that step don't bleed into the historical view.
          if (cursorState?.rewound) {
            const parentSegments = (lineage as { explorerSegments?: () => readonly string[] })?.explorerSegments?.() ?? []
            const allowed = await resolveChildNames(historyService, parentSegments, dir, content)
            union.clear()
            localCellSet.clear()
            for (const cell of allowed) {
              union.add(cell)
              localCellSet.add(cell)
            }
          }
        }
      }
    }

    // filter out cells removed via effect — only honor for active clipboard cut
    // or confirmed OPFS deletion. Stale #pendingRemoves entries must not hide
    // tiles that still exist in OPFS (prevents ghost removal after add/rename).
    if (!this.#clipboardView) {
      const clipSvc = get<any>('@diamondcoreprocessor.com/ClipboardService')
      const cutLabels = clipSvc?.operation === 'cut'
        ? new Set<string>((clipSvc.items as { label: string }[]).map((i: { label: string }) => i.label))
        : new Set<string>()
      const reconciled: string[] = []
      for (const cell of this.#pendingRemoves) {
        if (cutLabels.has(cell) || !localCellSet.has(cell)) {
          // active cut OR OPFS directory already deleted — honor the remove
          union.delete(cell)
        } else {
          // cell exists in OPFS but is not a cut item — stale pendingRemove, clear it
          reconciled.push(cell)
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
    const hiddenSet = new Set<string>(JSON.parse(localStorage.getItem(`hc:hidden-tiles:${locationKey}`) ?? '[]'))
    this.#currentHiddenSet = hiddenSet
    if (!this.#showHiddenItems) {
      for (const hidden of hiddenSet) {
        if (localCellSet.has(hidden)) union.delete(hidden)
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

    // resolve cell ordering through the layout mode strategy
    const cellNames = await this.#resolveCellOrder(this.#layoutMode, dir, union, localCellSet, lineage)

    const previousLocationKey = this.renderedLocationKey
    const layerChanged = locationKey !== previousLocationKey

    // note: if streaming is active for the same layer, let the stream finish
    if (this.streamActive && !layerChanged) return

    // note: layer changed — supersede any active stream, rebuild
    if (layerChanged) {
      // Bump the stream token FIRST, before any await. Any batch still
      // running inside the old stream will check this on its next
      // iteration boundary and bail out.
      const myToken = ++this.#streamToken
      this.renderedLocationKey = locationKey
      this.renderedCellsKey = ''
      this.renderedCells.clear()
      this.#pendingRemoves.clear()
      this.#slots.clear()  // layer change invalidates the slot state machine
      this.suppressMeshRecenter = false  // allow recenter on page navigation

      // apply saved viewport (or defaults) so the container is correct before tiles render.
      // Auto fit-to-content is intentionally disabled — zoomToFit only runs on explicit
      // user gesture. First-visit layers use the default/saved viewport as-is.
      await this.#applyViewportForLayer(dir)

      // If another layer change landed while we were awaiting the
      // viewport read, our token is already stale — abandon this path
      // and let the newer renderFromSynchronize drive the stream.
      if (myToken !== this.#streamToken) return

      // sync VP directory so subsequent pan/zoom writes persist to the correct layer
      const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
      if (vp) vp.setDirSilent(dir)

      if (cellNames.length === 0) {
        if (this.layer) this.layer.visible = true
        this.clearMesh()
        return
      }

      // hide layer until streaming completes — prevents flash/jump during progressive render
      if (this.layer) this.layer.visible = false

      // emit navigation guard so click handlers block during transition
      this.emitEffect('navigation:guard-start', { locationKey })

      // stream cells progressively (async, non-blocking). Pass our
      // token + locationKey so the stream works against the snapshot
      // that was authoritative when it started; if a newer stream
      // preempts, we stop touching shared state instead of fighting it.
      void this.streamCells(dir, cellNames, localCellSet, axial, branchSet, myToken, locationKey)
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

    if (wasEmpty && cells.length > 0 && this.pixiApp && this.pixiContainer && this.pixiRenderer && !this.suppressMeshRecenter) {
      // first tile on empty screen → center viewport and zoom 2×.
      // Gated on !suppressMeshRecenter: during undo/redo the cursor-
      // change handler sets that flag, and we MUST NOT touch the
      // viewport — the user expects to keep their current scale/pan
      // across history navigation. The empty→populated transition
      // (e.g. redo bringing cells back after undoing them all away)
      // would otherwise zoom them out of context.
      const s = this.pixiRenderer.screen
      this.pixiApp.stage.position.set(s.width * 0.5, s.height * 0.5)
      this.pixiContainer.scale.set(2)
      this.pixiContainer.position.set(0, 0)
      const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
      if (vp) {
        vp.setZoom(2, 0, 0)
        vp.setPan(0, 0)
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

  readonly #applyViewportForLayer = async (dir: FileSystemDirectoryHandle): Promise<boolean> => {
    // read 0000 directly from the target dir — VP.#dir may still
    // point at the previous layer (navigate fires before store.change)
    let snap: ViewportSnapshot = {}
    try {
      const fh = await dir.getFileHandle('0000')
      const file = await fh.getFile()
      const props = JSON.parse(await file.text())
      snap = (props as any).viewport ?? {}
    } catch {
      // no 0000 yet — defaults
    }

    // populate back-nav fast-path cache
    const locationKey = this.renderedLocationKey
    if (locationKey) this.#layerViewportCache.set(locationKey, snap)

    return this.#applyViewportFromSnapshot(snap)
  }

  #applyViewportFromSnapshot = (snap: ViewportSnapshot): boolean => {
    const container = this.pixiContainer
    const app = this.pixiApp
    const renderer = this.pixiRenderer
    if (!container || !app || !renderer) return false

    const s = renderer.screen

    if (snap.zoom) {
      container.scale.set(snap.zoom.scale)
      container.position.set(snap.zoom.cx, snap.zoom.cy)
    } else {
      container.scale.set(1)
      container.position.set(0, 0)
    }

    if (snap.pan) {
      app.stage.position.set(s.width * 0.5 + snap.pan.dx, s.height * 0.5 + snap.pan.dy)
    } else {
      app.stage.position.set(s.width * 0.5, s.height * 0.5)
    }

    return !!(snap.zoom || snap.pan)
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
    } else {
      if (this.geom) this.geom.destroy(true)
      this.hexMesh.geometry = geom
      this.hexMesh.shader = (this.shader as any).shader
    }

    if (this.hexMesh?.getLocalBounds && !this.suppressMeshRecenter) {
      this.hexMesh.position.set(0, 0)
      const bounds = this.hexMesh.getLocalBounds()
      this.hexMesh.position.set(-(bounds.x + bounds.width * 0.5), -(bounds.y + bounds.height * 0.5))
      this.emitEffect('render:mesh-offset', { x: this.hexMesh.position.x, y: this.hexMesh.position.y })
    }

    this.geom = geom
    this.renderedCellsKey = nextCellsKey
    this.renderedCount = cells.length

    // rebuild reverse axial lookup for O(1) tile:hover
    this.#axialToIndex.clear()
    for (let i = 0; i < cells.length; i++) {
      this.#axialToIndex.set(`${cells[i].q},${cells[i].r}`, i)
    }
    this.emitEffect('render:cell-count', {
      count: cells.length,
      labels: cells.map(cell => cell.label),
      coords: cells.map(cell => ({ q: cell.q, r: cell.r })),
      branchLabels: cells.filter(cell => cell.hasBranch).map(cell => cell.label),
      externalLabels: cells.filter(cell => cell.external).map(cell => cell.label),
      noImageLabels: cells.filter(cell => !cell.imageSig).map(cell => cell.label),
      substrateLabels: cells.filter(cell => cell.hasSubstrate).map(cell => cell.label),
      linkLabels: cells.filter(cell => cell.hasLink).map(cell => cell.label),
      hiddenLabels: this.#showHiddenItems ? [...this.#currentHiddenSet] : [],
    })
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

    // cell:added / cell:removed — synchronous incremental path. Zero awaits
    // in the click handler. The slot state machine mutates immediately, the
    // next microtask runs one applyGeometry, and images for new cells are
    // loaded fire-and-forget afterward. Rapid clicks in one JS turn coalesce
    // into a single render.
    this.onEffect<{ cell: string; groupId?: string }>('cell:added', (payload) => {
      this.suppressMeshRecenter = true
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
      this.suppressMeshRecenter = true
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

      // No early-return for "new layer at head" anymore. The previous
      // optimisation assumed an incremental cell:added/removed path
      // had already updated the view — but in the layer-driven model
      // the LAYER is the source of truth for what cells exist. A
      // newly-committed layer at head IS the only signal the
      // renderer has to learn that a cell was added; skipping the
      // re-render here was why the added tile didn't appear until
      // refresh or undo/redo.

      // Any actual cursor movement (undo/redo/seek) or rewound↔head transition
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
      // Without this, applyGeometry's mesh-recenter (line ~1720) shifts
      // the canvas every time the cell set changes — every step jerks
      // the camera and the user loses spatial context. Two-part guard:
      //   1. Suppress the mesh recenter for this re-render (the flag
      //      gets cleared again on the next genuine layer change).
      //   2. Snapshot stage / container transforms before requestRender
      //      and restore after, in case any other path nudges them.
      this.suppressMeshRecenter = true
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
    this.emitEffect('render:cell-count', { count: 0, labels: [] })
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

  private listCellFolders = async (dir: FileSystemDirectoryHandle): Promise<string[]> => {
    const out: string[] = []

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'directory') continue
      if (!name) continue

      if (name === '__dependencies__') continue
      if (name === '__bees__') continue
      if (name === '__layers__') continue
      if (name === '__location__') continue
      if (name.startsWith('__') && name.endsWith('__')) continue

      out.push(name)
    }

    out.sort((a, b) => a.localeCompare(b))
    return out
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

  async #orderByIndexPinned(dir: FileSystemDirectoryHandle, names: string[], localCellSet: Set<string>): Promise<string[]> {
    const axial = this.resolve<any>('axial')
    const maxSlot = axial?.count ?? 60
    const sparse: string[] = new Array(maxSlot + 1).fill('')

    let nextFree = 0
    const unindexed: string[] = []

    for (const name of names) {
      if (!localCellSet.has(name)) {
        unindexed.push(name)
        continue
      }
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readCellProperties(cellDir)
        if (typeof props['index'] === 'number') {
          const idx = props['index'] as number
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

    // place unindexed cells in the first available empty slots and persist their index
    for (const name of unindexed) {
      while (nextFree <= maxSlot && sparse[nextFree] !== '') nextFree++
      if (nextFree <= maxSlot) {
        sparse[nextFree] = name
        if (localCellSet.has(name)) {
          try {
            const cellDir = await dir.getDirectoryHandle(name, { create: false })
            await writeCellProperties(cellDir, { index: nextFree })
          } catch { /* skip */ }
        }
        nextFree++
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
        const axial = this.resolve<any>('axial')
        const maxSlot = axial?.count ?? 60
        const sparse: string[] = new Array(maxSlot + 1).fill('')
        for (let i = 0; i < filtered.length && i <= maxSlot; i++) {
          sparse[i] = filtered[i]
        }
        cellNames = sparse
      } else {
        cellNames = await this.#orderByIndexPinned(dir, Array.from(union), localCellSet)
      }
    } else {
      cellNames = await this.#orderByIndexPinned(dir, Array.from(union), localCellSet)
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
    const lineage = this.resolve<any>('lineage')
    if (!lineage) return
    const dir = await lineage.explorerDir() as FileSystemDirectoryHandle | null
    if (!dir) return

    // read all local cells and their current indices
    const localSeeds = await this.listCellFolders(dir)
    const entries: { name: string; index: number }[] = []

    for (const name of localSeeds) {
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readCellProperties(cellDir)
        entries.push({ name, index: typeof props['index'] === 'number' ? props['index'] as number : entries.length })
      } catch {
        entries.push({ name, index: entries.length })
      }
    }

    entries.sort((a, b) => a.index - b.index)

    // remove cell if already present, then insert at target
    const names = entries.map(e => e.name).filter(n => n !== cell)
    const clamped = Math.max(0, Math.min(targetIndex, names.length))
    names.splice(clamped, 0, cell)

    // write updated indices
    await this.#writeIndices(dir, names)
    this.requestRender()
  }

  async #handleReorder(labels: string[]): Promise<void> {
    const lineage = this.resolve<any>('lineage')
    if (!lineage) return
    const dir = await lineage.explorerDir() as FileSystemDirectoryHandle | null
    if (!dir) return

    await this.#writeIndices(dir, labels)
    this.renderedCellsKey = ''          // invalidate so renderFromSynchronize re-reads order
    this.#layerCellsCache.clear()       // clear stale cached cells for this layer
    this.requestRender()
  }

  async #writeIndices(dir: FileSystemDirectoryHandle, orderedNames: string[]): Promise<void> {
    // Rewrite each cell's index to match its position in orderedNames.
    // With offset phased out, the index alone determines placement, so
    // reorders just renumber indices starting at 0.
    for (let i = 0; i < orderedNames.length; i++) {
      const name = orderedNames[i]
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false })
        await writeCellProperties(cellDir, { index: i })
      } catch { /* skip missing cell dirs */ }
    }
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
    _dir: FileSystemDirectoryHandle,
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

    // Per-batch dedup so cells sharing an image (e.g. substrate fills) only fetch + decode once
    const inFlightImages = new Map<string, Promise<void>>()
    const loadImageOnce = (sig: string): Promise<void> => {
      if (imageAtlas.hasImage(sig) || imageAtlas.hasFailed(sig)) return Promise.resolve()
      const existing = inFlightImages.get(sig)
      if (existing) return existing
      const promise = (async () => {
        try {
          const blob = await store.getResource(sig)
          if (!blob) {
            console.warn(`[ShowCell] loadImageOnce: blob missing for ${sig.slice(0, 12)}…`)
            return
          }
          await imageAtlas.loadImage(sig, blob)
          if (!imageAtlas.hasImage(sig)) {
            console.warn(`[ShowCell] loadImageOnce: atlas.loadImage completed but hasImage=false for ${sig.slice(0, 12)}…`)
          }
        } catch (err) {
          console.warn(`[ShowCell] loadImageOnce: threw for ${sig.slice(0, 12)}…`, err)
        }
      })()
      inFlightImages.set(sig, promise)
      return promise
    }

    const loadOne = async (cell: Cell): Promise<void> => {
      // external cells don't have local OPFS data
      if (cell.external) return

      // load tags + link from OPFS if not cached (independent of image cache)
      if (!this.cellTagsCache.has(cell.label)) {
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
            console.log(`[ShowCell] fast-path reload ${cell.label} sig=${cachedSig.slice(0, 12)}…`)
            await loadImageOnce(cachedSig)
            if (!imageAtlas.hasImage(cachedSig)) {
              console.warn(`[ShowCell] fast-path reload FAILED for ${cell.label} sig=${cachedSig.slice(0, 12)}…`)
            }
          }
        } else {
          // cache entry is null — first visit resolved no image. This is
          // the commonest failure shape: substrate hadn't yet assigned
          // a propsSig when loadOne first ran, null got cached, and no
          // later path retries. Fall through to the slow path so we
          // re-read propsIndex in case substrate has since populated
          // it.
          this.cellImageCache.delete(cell.label)
          console.log(`[ShowCell] clearing stale null cache for ${cell.label}, retrying`)
        }
        if (this.cellImageCache.has(cell.label)) return
      }

      // read tile properties from content-addressed resource
      try {
        const propsSig = propsIndex[cell.label]
        if (!propsSig) {
          console.log(`[ShowCell] slow-path: no propsSig for ${cell.label} (propsIndex has ${Object.keys(propsIndex).length} entries, override=${this.#cursorPropsOverride?.size ?? 0})`)
          throw new Error('no props')
        }
        const blob = await store.getResource(propsSig)
        if (!blob) {
          console.warn(`[ShowCell] slow-path: propsSig ${propsSig.slice(0, 12)}… resolved to null blob for ${cell.label}`)
          throw new Error('no blob')
        }
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
          if (!imageAtlas.hasImage(smallSig)) {
            console.warn(`[ShowCell] slow-path loaded props for ${cell.label} but atlas has no image. propsSig=${propsSig.slice(0, 12)}… smallSig=${smallSig.slice(0, 12)}… flat=${this.#flat}`)
          }
        } else {
          console.log(`[ShowCell] slow-path: no image in props for ${cell.label} propsSig=${propsSig.slice(0, 12)}… flat=${this.#flat} props.small=${JSON.stringify(props?.small)} props.flat=${JSON.stringify(props?.flat)}`)
          this.cellImageCache.set(cell.label, null)
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