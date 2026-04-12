// diamondcoreprocessor.com/pixi/show-cell.drone.ts
import { Drone, SignatureService, SignatureStore } from '@hypercomb/core'
import { Application, Container, Geometry, Mesh, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { HexLabelAtlas } from '../grid/hex-label.atlas.js'
import { HexImageAtlas } from '../grid/hex-image.atlas.js'
import { HexSdfTextureShader } from '../grid/hex-sdf.shader.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY, createHexGeometry } from '../grid/hex-geometry.js'
import { isSignature, readCellProperties, writeCellProperties } from '../../editor/tile-properties.js'
import type { HistoryService, HistoryOp } from '../../history/history.service.js'
import type { HistoryCursorService } from '../../history/history-cursor.service.js'
import type { ViewportPersistence, ViewportSnapshot } from '../../navigation/zoom/zoom.drone.js'

type Axial = { q: number; r: number }
/** divergence: 0 = current, 1 = future-add (ghost), 2 = future-remove (marked) */
type Cell = { q: number; r: number; label: string; external: boolean; imageSig?: string; heat?: number; hasBranch?: boolean; hasLink?: boolean; hasSubstrate?: boolean; borderColor?: [number, number, number]; divergence?: number }

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

  protected override listens = ['render:host-ready', 'mesh:ready', 'mesh:items-updated', 'tile:saved', 'search:filter', 'render:set-orientation', 'render:set-pivot', 'mesh:room', 'mesh:secret', 'cell:place-at', 'cell:reorder', 'render:set-gap', 'move:preview', 'clipboard:captured', 'layout:mode', 'tags:changed', 'tags:filter', 'history:cursor-changed', 'tile:toggle-text', 'visibility:show-hidden', 'overlay:neon-color', 'translation:tile-start', 'translation:tile-done', 'substrate:changed', 'substrate:ready', 'substrate:applied', 'substrate:rerolled', 'cell:added', 'cell:removed']
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
  private cancelStreamFlag = false
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
  #clipboardView: { labels: Set<string>; sourceSegments: string[] } | null = null
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

  // add/remove sequence: hide layer → rebuild geometry → fit-to-content → reveal
  // Set when cell:added/removed fires; consumed at the end of the next render.
  #fitOnNextRender = false
  // Safety: if the synchronize that follows cell:added/removed never arrives,
  // restore the layer alpha so the user isn't stuck with invisible tiles.
  #fitFallbackTimer: ReturnType<typeof setTimeout> | null = null
  // First-visit fit: when navigating to a layer that has no saved viewport
  // snapshot, defer layer reveal until all cells have streamed in, then run
  // zoom-to-fit so the page opens sized to its content. The fitted viewport
  // is persisted, so subsequent visits restore it (or the user's later
  // pan/zoom edits) instead of fitting again.
  #fitAfterStream = false

  // cached render context for fast move:preview path (avoids full OPFS re-read)
  private cachedCellNames: string[] | null = null
  private cachedLocalCellSet: Set<string> | null = null
  private cachedBranchSet: Set<string> | null = null

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

  #cachedSigLocationKey = ''
  #cachedSigLocation: { key: string; sig: string } = { key: '', sig: '' }

  private computeSignatureLocation = async (lineage: any): Promise<{ key: string; sig: string }> => {
    const domain = String(lineage?.domain?.() ?? lineage?.domainLabel?.() ?? 'hypercomb.io')
    const explorerSegmentsRaw = lineage?.explorerSegments?.()
    const explorerSegments = Array.isArray(explorerSegmentsRaw)
      ? explorerSegmentsRaw
        .map((x: unknown) => String(x ?? '').trim())
        .filter((x: string) => x.length > 0)
      : []

    const lineagePath = explorerSegments.join('/')
    // key = space/domain/path/secret/cell (empty segments omitted)
    const parts = [this.#space, domain, lineagePath, this.#secret, 'cell'].filter(Boolean)
    const key = parts.join('/')

    // fast path: return cached result if key hasn't changed
    if (key === this.#cachedSigLocationKey) return this.#cachedSigLocation

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

  /**
   * Step 1 of the add/remove sequence: arm the fit-on-next-render flag and
   * make the tile layer invisible immediately so the user doesn't see the
   * geometry rebuild flicker. The next renderFromSynchronize that completes
   * applyGeometry will fit-to-content and reveal the layer.
   *
   * Uses alpha (not visible) so that getLocalBounds still includes the
   * existing tiles — the new fit calculation needs them.
   */
  #beginFitOnNextRender = (): void => {
    this.#fitOnNextRender = true
    if (this.layer) this.layer.alpha = 0
    if (this.#fitFallbackTimer) clearTimeout(this.#fitFallbackTimer)
    // Safety net: if no synchronize follows within a second, reveal anyway.
    this.#fitFallbackTimer = setTimeout(() => {
      this.#fitFallbackTimer = null
      if (this.#fitOnNextRender) {
        this.#fitOnNextRender = false
        if (this.layer) this.layer.alpha = 1
      }
    }, 1000)
  }

  /**
   * Steps 3 and 4 of the add/remove sequence: zoom-to-fit (snap, no animation
   * — the user is waiting on a hidden layer) then restore alpha so the tiles
   * reappear at their fitted positions in a single frame.
   */
  #completeFitAndReveal = (): void => {
    this.#fitOnNextRender = false
    if (this.#fitFallbackTimer) {
      clearTimeout(this.#fitFallbackTimer)
      this.#fitFallbackTimer = null
    }
    const zoom = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ZoomDrone') as
      { zoomToFit?: (snap?: boolean) => void } | undefined
    zoom?.zoomToFit?.(true)
    if (this.layer) this.layer.alpha = 1
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
    for (const cell of cells) {
      if (this.cellImageCache.has(cell.label)) {
        cell.imageSig = this.cellImageCache.get(cell.label) ?? undefined
      }
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    this.suppressMeshRecenter = true
    void this.applyGeometry(cells).finally(() => { this.suppressMeshRecenter = false })
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


    // instant back-navigation: if we have cached cells for this layer, apply them directly
    // — skips ALL OPFS reads (explorerDir, listCellFolders, checkCellHasBranch, history, layout)
    if (locationKey !== this.renderedLocationKey && this.#layerCellsCache.has(locationKey)) {
      const cached = this.#layerCellsCache.get(locationKey)!

      // ensure layer + atlases are initialized
      if (!this.layer) {
        this.layer = new Container()
        this.pixiContainer.addChild(this.layer)
        this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
        this.atlas.setPivot(this.#pivot)
        this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8)
        this.cellImageCache.clear()
        this.cellBorderColorCache.clear()
        this.cellTagsCache.clear()
        this.cellLinkCache.clear()
        this.cellSubstrateCache.clear()
        this.atlasRenderer = this.pixiRenderer
        this.shader = null
      }

      this.cancelStreamFlag = true
      this.renderedLocationKey = locationKey
      this.renderedCellsKey = ''
      this.renderedCells.clear()

      // restore per-layer viewport + sync VP directory
      const cachedDir = await lineage.explorerDir()
      if (cachedDir) {
        await this.#applyViewportForLayer(cachedDir)
        const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
        if (vp) vp.setDirSilent(cachedDir)
      }

      for (const cell of cached.cells) this.renderedCells.set(cell.label, cell)
      this.cachedCellNames = cached.cellNames
      this.cachedLocalCellSet = cached.localCellSet
      this.cachedBranchSet = cached.branchSet
      await this.applyGeometry(cached.cells)
      if (this.layer) this.layer.visible = true
      return
    }

    // note: init layer + atlases (and reset shader if renderer changes)
    if (!this.layer) {
      this.layer = new Container()
      this.pixiContainer.addChild(this.layer)

      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
      this.atlas.setPivot(this.#pivot)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8)
      this.cellImageCache.clear()
      this.cellBorderColorCache.clear()
      this.cellSubstrateCache.clear()
      this.atlasRenderer = this.pixiRenderer
      this.shader = null
    } else if (!this.atlas || this.atlasRenderer !== this.pixiRenderer) {
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
      this.atlas.setPivot(this.#pivot)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8)
      this.cellImageCache.clear()
      this.cellBorderColorCache.clear()
      this.cellSubstrateCache.clear()
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

    const dir = await lineage.explorerDir()
    if (!this.#clipboardView && isStale()) {
      this.renderQueued = true
      return
    }
    if (!dir) {
      console.warn('[show-honeycomb] BAIL: explorerDir returned null')
      this.clearMesh()
      return
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
    if (isStale()) {
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

      const cursorState = cursorService?.state
      const isRewound = cursorState?.rewound ?? false

      if (isRewound && cursorService) {
        // Rewound: use cursor's divergence computation
        const divergence = cursorService.computeDivergence()
        // Remove cells not in current set
        for (const cell of [...union]) {
          if (!divergence.current.has(cell) && !divergence.futureAdds.has(cell)) {
            union.delete(cell)
          }
        }
        // Add future-add cells back to union (they'll render as ghosts)
        for (const cell of divergence.futureAdds) union.add(cell)
        this.#divergenceFutureAdds = divergence.futureAdds
        this.#divergenceFutureRemoves = divergence.futureRemoves

        // ── Reconstruct tag/content/layout state at cursor time ──
        const reconKey = `${cursorState!.locationSig}:${cursorState!.position}`
        const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as
          { getResource: (sig: string) => Promise<Blob | null> } | undefined
        if (store && reconKey !== this.#cursorReconstructionKey) {
          this.#cursorReconstructionKey = reconKey
          const tagSigs = cursorService.collectTagStateSignatures()
          const cursorTagMap = new Map<string, string[]>()
          for (const tagSig of tagSigs) {
            try {
              const blob = await store.getResource(tagSig)
              if (!blob) continue
              const snapshot = JSON.parse(await blob.text())
              if (snapshot?.cellTags) {
                for (const [cellLabel, tags] of Object.entries(snapshot.cellTags)) {
                  cursorTagMap.set(cellLabel, tags as string[])
                }
              }
            } catch { /* skip corrupted */ }
          }
          // Override tag cache with cursor-time state
          for (const [cellLabel, tags] of cursorTagMap) {
            this.cellTagsCache.set(cellLabel, tags)
          }

          // ── Reconstruct content state at cursor time ──────────
          const contentOps = cursorService.opsAtCursor('content-state')
          const cursorPropsOverride = new Map<string, string>()
          for (const op of contentOps) {
            try {
              const blob = await store.getResource(op.cell)
              if (!blob) continue
              const snapshot = JSON.parse(await blob.text())
              if (snapshot?.cellLabel && snapshot?.propertiesSig) {
                cursorPropsOverride.set(snapshot.cellLabel, snapshot.propertiesSig)
              }
            } catch { /* skip corrupted */ }
          }
          if (cursorPropsOverride.size > 0) {
            this.#cursorPropsOverride = cursorPropsOverride
          }

          // ── Reconstruct layout state at cursor time ──────────
          const layoutOps = cursorService.opsAtCursor('layout-state')
          for (const op of layoutOps) {
            try {
              const blob = await store.getResource(op.cell)
              if (!blob) continue
              const snapshot = JSON.parse(await blob.text())
              if (snapshot?.property && snapshot?.value !== undefined) {
                switch (snapshot.property) {
                  case 'orientation': {
                    const flat = snapshot.value === 'flat-top'
                    if (this.#flat !== flat) {
                      this.#flat = flat
                      this.cellImageCache.clear()
                    }
                    break
                  }
                  case 'pivot': {
                    const pivot = snapshot.value === 'true'
                    if (this.#pivot !== pivot) {
                      this.#pivot = pivot
                      this.atlas?.setPivot(pivot)
                    }
                    break
                  }
                  case 'gap': {
                    const gapPx = parseFloat(snapshot.value)
                    if (!isNaN(gapPx) && this.#hexGeo.gapPx !== gapPx) {
                      this.#hexGeo = createHexGeometry(this.#hexGeo.circumRadiusPx, gapPx, this.#hexGeo.padPx)
                    }
                    break
                  }
                  case 'mode': {
                    const mode = snapshot.value as 'dense' | 'pinned'
                    if (mode === 'dense' || mode === 'pinned') {
                      this.#layoutMode = mode
                    }
                    break
                  }
                }
              }
            } catch { /* skip corrupted */ }
          }
        }
      } else {
        // Not rewound: standard replay — filter out removed cells
        // Only honor 'remove' when the cell's OPFS directory no longer exists.
        // A directory that still (or again) exists means the cell was just
        // recreated — the async HistoryRecorder hasn't written the 'add' op yet.
        const ops = await historyService.replay(sig.sig)
        const cellState = new Map<string, string>()
        for (const op of ops) cellState.set(op.cell, op.op)
        for (const [cell, lastOp] of cellState) {
          if (lastOp === 'remove' && !localCellSet.has(cell)) union.delete(cell)
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

    // When cursor is rewound, use history-reconstructed hidden set instead of localStorage
    const cursorState = cursorService?.state
    const hiddenSet = (cursorState?.rewound && cursorService)
      ? cursorService.computeDivergence().hiddenAtCursor
      : new Set<string>(JSON.parse(localStorage.getItem(`hc:hidden-tiles:${locationKey}`) ?? '[]'))
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
    }

    // read layout mode for this location
    this.#layoutMode = this.#readLayoutMode(locationKey)

    // resolve cell ordering through the layout mode strategy
    const cellNames = await this.#resolveCellOrder(this.#layoutMode, dir, union, localCellSet, lineage)

    const previousLocationKey = this.renderedLocationKey
    const layerChanged = locationKey !== previousLocationKey

    // note: if streaming is active for the same layer, let the stream finish
    if (this.streamActive && !layerChanged) return

    // note: layer changed — cancel active stream, rebuild
    if (layerChanged) {
      this.cancelStreamFlag = true
      this.renderedLocationKey = locationKey
      this.renderedCellsKey = ''
      this.renderedCells.clear()
      this.#pendingRemoves.clear()
      this.suppressMeshRecenter = false  // allow recenter on page navigation
      // Layer change supersedes any pending fit — the layer-change flow has
      // its own visibility/viewport handling. Drop the flag and reveal so the
      // streaming reveal logic isn't fighting alpha=0 from the previous page.
      if (this.#fitOnNextRender) {
        this.#fitOnNextRender = false
        if (this.#fitFallbackTimer) {
          clearTimeout(this.#fitFallbackTimer)
          this.#fitFallbackTimer = null
        }
        if (this.layer) this.layer.alpha = 1
      }
      // Reset any pending first-visit fit from a superseded navigation.
      this.#fitAfterStream = false

      // apply saved viewport (or defaults) so the container is correct before tiles render
      const hasSavedViewport = await this.#applyViewportForLayer(dir)
      // First visit to this layer (no persisted viewport) → fit-to-content
      // after streaming completes. streamCells will delay layer reveal until
      // the fit has been applied so the user doesn't see an unfitted flash.
      this.#fitAfterStream = !hasSavedViewport

      // sync VP directory so subsequent pan/zoom writes persist to the correct layer
      const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
      if (vp) vp.setDirSilent(dir)

      if (cellNames.length === 0) {
        if (this.layer) this.layer.visible = true
        this.clearMesh()
        // nothing to fit on an empty layer — drop the flag so a later render
        // doesn't mis-fire with stale state
        this.#fitAfterStream = false
        return
      }

      // hide layer until streaming completes — prevents flash/jump during progressive render
      if (this.layer) this.layer.visible = false

      // emit navigation guard so click handlers block during transition
      this.emitEffect('navigation:guard-start', { locationKey })

      // stream cells progressively (async, non-blocking)
      void this.streamCells(dir, cellNames, localCellSet, axial, branchSet)
      return
    }

    // note: same layer — incremental path (cell collection was fresh, images are cached)
    if (cellNames.length === 0) {
      this.clearMesh()
      // If we hid the layer for an add/remove sequence and the result is an
      // empty page, there's nothing to fit — just reveal so the user isn't
      // staring at an invisible empty grid.
      if (this.#fitOnNextRender) {
        this.#fitOnNextRender = false
        if (this.#fitFallbackTimer) {
          clearTimeout(this.#fitFallbackTimer)
          this.#fitFallbackTimer = null
        }
        if (this.layer) this.layer.alpha = 1
      }
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

    // add/remove sequence step 3+4: fit-to-content, then reveal the layer.
    // Step 1 (hide) happened in the cell:added/removed handler; step 2
    // (geometry rebuild) is the applyGeometry call above.
    if (this.#fitOnNextRender) {
      this.#completeFitAndReveal()
    } else if (wasEmpty && cells.length > 0 && this.pixiApp && this.pixiContainer && this.pixiRenderer) {
      // first tile on empty screen → center viewport and zoom 2×
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
  }

  private readonly streamCells = async (
    dir: FileSystemDirectoryHandle,
    cellNames: string[],
    localCellSet: Set<string>,
    axial: any,
    branchSet?: Set<string>,
  ): Promise<void> => {
    this.streamActive = true
    this.cancelStreamFlag = false

    // resolve all cell→axial positions through the single mapping function
    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : cellNames.length
    const maxCells = Math.min(cellNames.length, axialMax)
    const allCells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet)

    const cells: Cell[] = []
    const BATCH = ShowCellDrone.STREAM_BATCH_SIZE

    for (let start = 0; start < allCells.length; start += BATCH) {
      if (this.cancelStreamFlag) break

      const batch = allCells.slice(start, start + BATCH)

      // load all cells in this batch in parallel — file reads + image decodes overlap
      await this.loadCellImages(batch, dir)
      if (this.cancelStreamFlag) break

      for (const cell of batch) {
        cells.push(cell)
        this.renderedCells.set(cell.label, cell)
      }

      const isLast = start + BATCH >= allCells.length
      await this.applyGeometry(cells, isLast)

      // reveal the layer as soon as the first batch is on-screen so cold start
      // shows tiles immediately and the rest stream in progressively — unless
      // we're deferring reveal for a first-visit fit-to-content, in which case
      // we wait for the full stream before fitting and revealing together.
      if (!this.cancelStreamFlag && this.layer && !this.layer.visible && !this.#fitAfterStream) {
        this.layer.visible = true
      }

      if (!isLast) await this.microDelay()
    }

    // first-visit fit: content is fully streamed, bounds are stable — fit now,
    // then reveal so the page opens already sized to its content. The fitted
    // viewport is persisted by zoomToFit, so subsequent visits restore it.
    if (!this.cancelStreamFlag && this.#fitAfterStream && cells.length > 0) {
      this.#fitAfterStream = false
      const zoom = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ZoomDrone') as
        { zoomToFit?: (snap?: boolean) => void } | undefined
      zoom?.zoomToFit?.(true)
    } else if (this.#fitAfterStream) {
      // stream cancelled or empty — clear the flag so a later render isn't
      // mis-armed by stale state
      this.#fitAfterStream = false
    }

    // safety: ensure layer is visible if loop exited without rendering anything
    if (!this.cancelStreamFlag && this.layer) this.layer.visible = true

    this.streamActive = false
    this.emitEffect('navigation:guard-end', {})

    // cache for instant back-navigation
    if (!this.cancelStreamFlag && cells.length > 0) {
      const locKey = this.renderedLocationKey
      this.#layerCellsCache.set(locKey, { cells: [...cells], cellNames, localCellSet, branchSet: branchSet ?? new Set() })
    }

    this.requestRender()
  }

  readonly #applyViewportForLayer = async (dir: FileSystemDirectoryHandle): Promise<boolean> => {
    const container = this.pixiContainer
    const app = this.pixiApp
    const renderer = this.pixiRenderer
    if (!container || !app || !renderer) return false

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

    const s = renderer.screen

    // zoom: set scale + position on the render container
    if (snap.zoom) {
      container.scale.set(snap.zoom.scale)
      container.position.set(snap.zoom.cx, snap.zoom.cy)
    } else {
      container.scale.set(1)
      container.position.set(0, 0)
    }

    // pan: set stage position
    if (snap.pan) {
      app.stage.position.set(s.width * 0.5 + snap.pan.dx, s.height * 0.5 + snap.pan.dy)
    } else {
      app.stage.position.set(s.width * 0.5, s.height * 0.5)
    }

    // true if this layer has a persisted viewport (zoom or pan). When false,
    // the caller can trigger a first-visit fit-to-content after content renders.
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

    // tile:saved effect — invalidate image cache for the specific cell so re-render picks up new image
    this.onEffect<{ cell: string }>('tile:saved', (payload) => {
      if (payload?.cell) {
        const oldSig = this.cellImageCache.get(payload.cell)
        this.cellImageCache.delete(payload.cell)
        this.cellBorderColorCache.delete(payload.cell)
        this.cellTagsCache.delete(payload.cell)
        this.cellLinkCache.delete(payload.cell)
        if (oldSig && this.imageAtlas) {
          this.imageAtlas.invalidate(oldSig)
        }
      }
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // tags:changed effect — invalidate tag cache for affected cells and re-emit render:tags
    this.onEffect<{ updates: { cell: string }[] }>('tags:changed', (payload) => {
      if (!payload?.updates) return
      for (const { cell } of payload.updates) {
        this.cellTagsCache.delete(cell)
      }
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // cell:added / cell:removed — invalidate render cache so next synchronize picks up new tile set
    // suppress mesh recenter so existing tiles don't shift visually on add/remove
    this.onEffect<{ cell: string; groupId?: string }>('cell:added', (payload) => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.suppressMeshRecenter = true
      if (payload?.cell) {
        this.#pendingRemoves.delete(payload.cell)
        this.#startNewCellFade(payload.cell)
      }
      // Rename emits removed+added with a 'rename:' groupId — cell count is
      // unchanged so fit is unnecessary and the hide/show would just flicker.
      if (!String(payload?.groupId ?? '').startsWith('rename:')) {
        this.#beginFitOnNextRender()
      }
    })

    this.onEffect<{ cell: string; groupId?: string }>('cell:removed', (payload) => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.suppressMeshRecenter = true
      if (payload?.cell) {
        this.#pendingRemoves.add(payload.cell)
        this.cellImageCache.delete(payload.cell)
        this.cellTagsCache.delete(payload.cell)
        this.cellLinkCache.delete(payload.cell)
        this.cellBorderColorCache.delete(payload.cell)
      }
      if (!String(payload?.groupId ?? '').startsWith('rename:')) {
        this.#beginFitOnNextRender()
      }
    })

    // history:cursor-changed — re-render with divergence when cursor moves
    this.onEffect('history:cursor-changed', () => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
      this.requestRender()
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
    this.onEffect<{ active: boolean; labels?: string[]; sourceSegments?: string[] }>('clipboard:view', (payload) => {
      if (payload?.active && payload.labels) {
        this.#clipboardView = {
          labels: new Set(payload.labels),
          sourceSegments: payload.sourceSegments ?? [],
        }
      } else {
        this.#clipboardView = null
      }
      this.renderedCellsKey = '' // force full geometry rebuild on enter/exit
      this.requestRender()
    })

    // clipboard:captured — brief visual flash on copied tiles
    this.onEffect<{ labels: string[]; op: string }>('clipboard:captured', (payload) => {
      if (!payload?.labels?.length) return

      if (payload.op === 'copy') {
        // Flash copied tiles via heat override
        if (this.#flashTimer) clearTimeout(this.#flashTimer)
        this.#flashLabels = new Set(payload.labels)
        for (const label of payload.labels) this.#heatByLabel.set(label, 1.0)
        this.renderedCellsKey = '' // force geometry rebuild
        this.requestRender()

        this.#flashTimer = setTimeout(() => {
          for (const label of this.#flashLabels) this.#heatByLabel.delete(label)
          this.#flashLabels.clear()
          this.#flashTimer = null
          this.renderedCellsKey = ''
          this.requestRender()
        }, 600)
      }
      // cut: tiles disappear via history remove ops + synchronize (handled by ClipboardWorker)
    })

    // translation:tile-start — apply sustained heat glow on tiles being translated
    this.onEffect<{ labels: string[]; locale: string }>('translation:tile-start', (payload) => {
      if (!payload?.labels?.length) return
      for (const label of payload.labels) {
        this.#translatingLabels.add(label)
        this.#heatByLabel.set(label, 0.5)
      }
      this.renderedCellsKey = ''
      this.requestRender()

      // Pulse the heat to show ongoing activity
      if (!this.#translationPulseTimer) {
        this.#translationPulseTimer = setInterval(() => {
          if (!this.#translatingLabels.size) {
            clearInterval(this.#translationPulseTimer!)
            this.#translationPulseTimer = null
            return
          }
          const t = Date.now() / 1000
          const pulse = 0.3 + 0.2 * Math.sin(t * 3)
          for (const label of this.#translatingLabels) this.#heatByLabel.set(label, pulse)
          this.renderedCellsKey = ''
          this.requestRender()
        }, 100)
      }
    })

    // translation:tile-done — clear heat on individual tile when its translation finishes
    this.onEffect<{ label: string }>('translation:tile-done', (payload) => {
      if (!payload?.label) return
      this.#translatingLabels.delete(payload.label)
      this.#heatByLabel.delete(payload.label)
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

    // substrate:applied — substrate has just written a new propsSig into
    // localStorage for this cell. Drop the cached image entry so the next
    // loadCellImages pass re-reads the props from disk and picks up the new
    // sig. requestRender is microtask-coalesced so a burst of N applies
    // collapses to a single render pass.
    this.onEffect<{ cell: string }>('substrate:applied', (payload) => {
      if (!payload?.cell) return
      this.cellImageCache.delete(payload.cell)
      this.cellSubstrateCache.delete(payload.cell)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // substrate:rerolled — user clicked the reroll action on a tile. Substrate
    // has written a fresh propsSig into localStorage; drop the cached image
    // entry (and invalidate the old image atlas slot) so the next render pass
    // reads the new sig from disk. Without this the fast-path at
    // renderFromSynchronize short-circuits because renderedCellsKey is still
    // valid, and the tile only refreshes on a full page reload.
    this.onEffect<{ cell: string }>('substrate:rerolled', (payload) => {
      if (!payload?.cell) return
      const oldSig = this.cellImageCache.get(payload.cell)
      this.cellImageCache.delete(payload.cell)
      this.cellSubstrateCache.delete(payload.cell)
      if (oldSig && this.imageAtlas) {
        this.imageAtlas.invalidate(oldSig)
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

    this.onEffect<{ cell: string; index: number }>('cell:place-at', (payload) => {
      void this.#handlePlaceAt(payload.cell, payload.index)
    })

    this.onEffect<{ labels: string[] }>('cell:reorder', (payload) => {
      void this.#handleReorder(payload.labels)
    })

    this.onEffect<{ mode: 'dense' | 'pinned' }>('layout:mode', (payload) => {
      if (payload?.mode && payload.mode !== this.#layoutMode) {
        this.#layoutMode = payload.mode
        this.#persistLayoutMode(payload.mode)
        this.#layerCellsCache.clear()
        this.renderedCellsKey = ''
        this.requestRender()
      }
    })

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
    this.renderedCellsKey = ''
    this.requestRender()
    if (this.#newCellFadeRaf) return

    const tick = (): void => {
      const now = performance.now()
      let alive = false
      for (const [cell, start] of this.#newCellFadeStart) {
        const elapsed = now - start
        if (elapsed >= ShowCellDrone.#NEW_CELL_FADE_MS) {
          this.#newCellFadeStart.delete(cell)
          this.#heatByLabel.delete(cell)
          continue
        }
        const t = 1 - (elapsed / ShowCellDrone.#NEW_CELL_FADE_MS)
        // ease-out cubic for a soft fade tail
        this.#heatByLabel.set(cell, t * t * t)
        alive = true
      }
      this.renderedCellsKey = ''
      this.requestRender()
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

  private readonly rebuildRenderResources = (renderer: unknown): void => {
    this.clearMesh()
    this.shader = null
    this.atlas = new HexLabelAtlas(renderer, 128, 8, 8)
    this.imageAtlas = new HexImageAtlas(renderer, 256, 8, 8)
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

  #readLayoutMode(locationKey: string): 'dense' | 'pinned' {
    const stored = localStorage.getItem(this.#layoutModeKey(locationKey))
    return stored === 'pinned' ? 'pinned' : 'dense'
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
            await writeCellProperties(cellDir, { index: nextFree, offset: 0 })
          } catch { /* skip */ }
        }
        nextFree++
      }
    }

    return sparse
  }

  /**
   * Central ordering strategy — all render paths route through here.
   * Each layout mode implements its own ordering logic; new modes add a case.
   * Returns a name array ready for buildCellsFromAxial:
   *   - dense: packed array (cellNames[i] → axial position i)
   *   - pinned: sparse array with empty-string gaps (cellNames[i] → axial position i)
   */
  async #resolveCellOrder(
    mode: string,
    dir: FileSystemDirectoryHandle,
    union: Set<string>,
    localCellSet: Set<string>,
    lineage: any,
  ): Promise<string[]> {
    switch (mode) {
      case 'pinned': {
        let cellNames = await this.#orderByIndexPinned(dir, Array.from(union), localCellSet)
        if (this.filterKeyword) {
          const kw = this.filterKeyword
          cellNames = cellNames.map(s => s && s.toLowerCase().includes(kw) ? s : '')
        }
        return cellNames
      }

      // dense (default): pack tiles contiguously
      default: {
        let cellNames: string[]
        let orderFromProjection = false

        const orderProjection = (window as any).ioc?.get?.('@diamondcoreprocessor.com/OrderProjection') as
          { hydrate(sig: string): Promise<string[]> } | undefined
        if (orderProjection) {
          const locSig = await this.computeSignatureLocation(lineage)
          const order = await orderProjection.hydrate(locSig.sig)
          if (order.length > 0) {
            orderFromProjection = true
            const unionSet = new Set(union)
            cellNames = order.filter(s => unionSet.has(s))
            for (const s of union) {
              if (!cellNames.includes(s)) cellNames.push(s)
            }
          } else {
            cellNames = await this.#orderByIndex(dir, Array.from(union), localCellSet)
          }
        } else {
          cellNames = await this.#orderByIndex(dir, Array.from(union), localCellSet)
        }

        // apply __layout__ ONLY as initial fallback — OrderProjection is authoritative
        // once it has data from add/remove/reorder history
        if (!orderFromProjection) {
          const layout = this.resolve<any>('layout')
          if (layout) {
            const order = await layout.read(dir)
            if (order) cellNames = layout.merge(order, cellNames)
          }
        }

        if (this.filterKeyword) {
          const kw = this.filterKeyword
          cellNames = cellNames.filter((s: string) => s.toLowerCase().includes(kw))
        }
        return cellNames
      }
    }
  }

  /**
   * Order cells by their persisted index in the 0000 properties file.
   * Cells without an index get the next available index and are written back.
   * External (mesh) cells are always re-indexed locally.
   */
  async #orderByIndex(dir: FileSystemDirectoryHandle, names: string[], localCellSet: Set<string>): Promise<string[]> {
    const indexed: { name: string; position: number }[] = []
    const unindexed: string[] = []
    let maxIndex = -1

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
          const off = typeof props['offset'] === 'number' ? props['offset'] as number : 0
          indexed.push({ name, position: idx + off })
          if (idx > maxIndex) maxIndex = idx
        } else {
          unindexed.push(name)
        }
      } catch {
        unindexed.push(name)
      }
    }

    // sort by effective position (index + offset)
    indexed.sort((a, b) => a.position - b.position)

    // assign next available permanent index to unindexed cells
    // offset must place new tiles AFTER all existing tiles so existing positions don't shift
    let nextIndex = maxIndex + 1
    const maxEffective = indexed.length > 0 ? indexed[indexed.length - 1].position : -1
    let nextPosition = maxEffective + 1

    if (indexed.length === 0) {
      unindexed.sort((a, b) => a.localeCompare(b))
    }

    for (const name of unindexed) {
      const assignedIndex = nextIndex++
      const effectivePosition = nextPosition++
      const offset = effectivePosition - assignedIndex
      indexed.push({ name, position: effectivePosition })

      if (localCellSet.has(name)) {
        try {
          const cellDir = await dir.getDirectoryHandle(name, { create: false })
          await writeCellProperties(cellDir, { index: assignedIndex, offset })
        } catch { /* cell dir missing — skip */ }
      }
    }
    return indexed.map(s => s.name)
  }

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
    // read all existing permanent indices to find maxIndex for new tiles
    let maxIndex = -1
    const existingIndices = new Map<string, number>()
    for (const name of orderedNames) {
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readCellProperties(cellDir)
        if (typeof props['index'] === 'number') {
          existingIndices.set(name, props['index'] as number)
          if ((props['index'] as number) > maxIndex) maxIndex = props['index'] as number
        }
      } catch { /* skip */ }
    }

    for (let i = 0; i < orderedNames.length; i++) {
      const name = orderedNames[i]
      let permanentIndex = existingIndices.get(name)
      if (permanentIndex === undefined) {
        permanentIndex = ++maxIndex
      }
      const offset = i - permanentIndex
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false })
        await writeCellProperties(cellDir, { index: permanentIndex, offset })
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
  private loadCellImages = async (cells: Cell[], _dir: FileSystemDirectoryHandle): Promise<void> => {
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
          if (blob) await imageAtlas.loadImage(sig, blob)
        } catch {
          console.warn(`[ShowCell] failed to load image ${sig}`)
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

      // check cache first
      if (this.cellImageCache.has(cell.label)) {
        cell.imageSig = this.cellImageCache.get(cell.label) ?? undefined
        cell.borderColor = this.cellBorderColorCache.get(cell.label)
        cell.hasLink = this.cellLinkCache.get(cell.label) ?? false
        cell.hasSubstrate = this.cellSubstrateCache.get(cell.label) ?? false
        return
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

        const smallSig = (this.#flat && props?.flat?.small?.image) || props?.small?.image
        if (smallSig && isSignature(smallSig)) {
          cell.imageSig = smallSig
          this.cellImageCache.set(cell.label, smallSig)
          await loadImageOnce(smallSig)
        } else {
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
    let s = `p${this.#pivot ? 1 : 0}f${this.#flat ? 1 : 0}|`
    for (const c of cells) s += `${c.q},${c.r}:${c.label}:${c.external ? 1 : 0}:${c.imageSig ?? ''}:${c.hasBranch ? 1 : 0}:${c.divergence ?? 0}|`
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

      const ruv = this.atlas!.getLabelUV(c.label)
      for (let i = 0; i < 4; i++) {
        labelUV.set([ruv.u0, ruv.v0, ruv.u1, ruv.v1], luvp)
        luvp += 4
      }

      // cell image atlas UVs (text-only suppression handled by u_imageMix shader uniform)
      const imgUV = c.imageSig ? this.imageAtlas?.getImageUV(c.imageSig) ?? null : null
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

    return g
  }
}

const showCell = new ShowCellDrone()
window.ioc.register('@diamondcoreprocessor.com/ShowCellDrone', showCell)