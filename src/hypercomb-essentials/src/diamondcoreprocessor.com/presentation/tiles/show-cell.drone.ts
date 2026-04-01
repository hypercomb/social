// diamondcoreprocessor.com/pixi/show-cell.drone.ts
import { Drone, SignatureService, SignatureStore } from '@hypercomb/core'
import { Application, Container, Geometry, Mesh, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { HexLabelAtlas } from '../grid/hex-label.atlas.js'
import { HexImageAtlas } from '../grid/hex-image.atlas.js'
import { HexSdfTextureShader } from '../grid/hex-sdf.shader.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY, createHexGeometry } from '../grid/hex-geometry.js'
import { isSignature, readSeedProperties, writeSeedProperties } from '../../editor/tile-properties.js'
import type { HistoryService, HistoryOp } from '../../history/history.service.js'
import type { HistoryCursorService } from '../../history/history-cursor.service.js'
import type { ViewportPersistence, ViewportSnapshot } from '../../navigation/zoom/zoom.drone.js'

type Axial = { q: number; r: number }
/** divergence: 0 = current, 1 = future-add (ghost), 2 = future-remove (marked) */
type SeedCell = { q: number; r: number; label: string; external: boolean; imageSig?: string; heat?: number; hasBranch?: boolean; hasLink?: boolean; borderColor?: [number, number, number]; divergence?: number }

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
    'Renders the hex grid — maps seeds to cells, manages geometry, and syncs with the Nostr mesh.'
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

  protected override listens = ['render:host-ready', 'mesh:ready', 'mesh:items-updated', 'tile:saved', 'search:filter', 'render:set-orientation', 'render:set-pivot', 'mesh:room', 'mesh:secret', 'seed:place-at', 'seed:reorder', 'render:set-gap', 'move:preview', 'clipboard:captured', 'layout:mode', 'tags:changed', 'tags:filter', 'history:cursor-changed', 'tile:toggle-text', 'visibility:show-hidden']
  protected override emits = ['mesh:ensure-started', 'mesh:subscribe', 'mesh:publish', 'render:mesh-offset', 'render:cell-count', 'render:geometry-changed', 'render:tags', 'tile:hover-tags']
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private atlas: HexLabelAtlas | null = null
  private imageAtlas: HexImageAtlas | null = null
  private atlasRenderer: unknown = null

  // cache: seed label → small image signature (avoids re-reading 0000 on every render)
  private readonly seedImageCache = new Map<string, string | null>()
  // cache: seed label → tag names (avoids re-reading 0000 on every render)
  private readonly seedTagsCache = new Map<string, string[]>()
  // cache: seed label → border color RGB floats
  private readonly seedBorderColorCache = new Map<string, [number, number, number]>()
  // cache: seed label → has link property
  private readonly seedLinkCache = new Map<string, boolean>()

  private lastKey = ''

  private listening = false
  private rendering = false
  private renderQueued = false

  private renderedCellsKey = ''
  private renderedCount = 0

  private lineageChangeListening = false

  // incremental rendering state — tracks what's currently painted (geometry cache)
  private readonly renderedCells = new Map<string, SeedCell>()
  // per-layer cache: location key → cells array (for instant back-navigation)
  #layerCellsCache = new Map<string, { cells: SeedCell[]; seedNames: string[]; localSeedSet: Set<string>; branchSet: Set<string> }>()
  #heatByLabel = new Map<string, number>()
  #flashLabels = new Set<string>()
  #flashTimer: ReturnType<typeof setTimeout> | null = null
  private streamActive = false
  private cancelStreamFlag = false
  private renderedLocationKey = ''
  #axialToIndex = new Map<string, number>()
  #heartbeatInitialized = false
  #lastHeartbeatKey = ''

  // hex geometry (circumradius, gap, pad, spacing) — configurable via render:set-gap effect
  #hexGeo: HexGeometry = DEFAULT_HEX_GEOMETRY

  // hex orientation: 'point-top' (default) or 'flat-top'
  #flat = false
  #pivot = false
  #textOnly = false
  #labelsVisible = true
  #showHiddenItems = false
  #currentHiddenSet = new Set<string>()

  // mesh scoping — space + secret feed into the signature key
  #space = ''
  #secret = ''

  // note: mesh seed state (derived on heartbeat)
  private meshSig = ''
  private meshSeedsRev = 0
  private meshSeeds: string[] = []

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
  private lastLocalSeedsBySig = new Map<string, string[]>()
  private lastPublishedGrammarSig = ''
  private lastPublishedGrammarSeed = ''

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
  private suppressMeshRecenter = false
  #layoutMode: 'dense' | 'pinned' = 'dense'

  // cached render context for fast move:preview path (avoids full OPFS re-read)
  private cachedSeedNames: string[] | null = null
  private cachedLocalSeedSet: Set<string> | null = null
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

    // mesh seed refresh — only when lineage/grammar actually changed
    const lineage = this.resolve<any>('lineage')
    const locationKey = String(lineage?.explorerLabel?.() ?? '/')
    const fsRev = Number(lineage?.changed?.() ?? 0)
    const heartbeatKey = `${locationKey}:${fsRev}:${grammar}`
    if (heartbeatKey !== this.#lastHeartbeatKey) {
      this.#lastHeartbeatKey = heartbeatKey
      await this.refreshMeshSeeds(grammar)
      this.requestRender()
    }
  }

  private refreshMeshSeeds = async (grammar: string = ''): Promise<void> => {

    const lineage = this.resolve<any>('lineage')
    const mesh = this.tryGetMesh()
    if (!lineage || !mesh) return

    const signatureLocation = await this.computeSignatureLocation(lineage)
    const sig = signatureLocation.sig

    if (sig !== this.meshSig) {
      const NOSTR = 'wss://relay.snort.social'
      const nakPayload = '{"seeds":["external.alpha","Street Fighter"]}'
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
      this.meshSeeds = []
      this.meshSeedsRev++

      if (typeof mesh.subscribe === 'function') {
        this.meshSub = mesh.subscribe(sig, (evt) => {
          // detect sync-request from another publisher — trigger immediate republish
          this.#handleIncomingSyncRequest(evt, mesh, sig)

          void (async () => {
            await this.refreshMeshSeeds()
            this.requestRender()
          })()
        })
      }
    }

    // note: ensure relays are queried for this sig (direct call + effect for observability)
    mesh.ensureStartedForSig(sig)
    this.emitEffect('mesh:ensure-started', { signature: sig })


    // note: publish local filesystem seeds for this sig when changed
    await this.publishLocalSeeds(lineage, mesh, sig, grammar)

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
      if (this.meshSeeds.length !== 0) {
        this.meshSeeds = []
        this.meshSeedsRev++
      }
      return
    }

    // note: union seeds across all non-expired payloads
    // - supports payload shapes:
    //   1) { seeds: string[] }
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

      const fromContent = this.extractSeedsFromEventContent(it?.event?.content)
      if (fromContent.length > 0) {
        for (const seed of fromContent) set.add(seed)
        continue
      }

      if (Array.isArray(p)) {
        for (const x of p) {
          const s = String(x ?? '').trim()
          this.addCsvSeeds(set, s)
        }
        continue
      }

      if (typeof p === 'string') {
        const parsed = this.extractSeedsFromEventContent(p)
        if (parsed.length > 0) {
          for (const seed of parsed) set.add(seed)
        } else if (!this.looksStructuredContent(p)) {
          this.addCsvSeeds(set, p)
        }
        continue
      }

      const seedsArr = p?.seeds
      if (Array.isArray(seedsArr)) {
        for (const x of seedsArr) {
          const s = String(x ?? '').trim()
          this.addCsvSeeds(set, s)
        }
      }

      const singleSeed = String(p?.seed ?? '').trim()
      this.addCsvSeeds(set, singleSeed)
    }

    const next = Array.from(set)
    next.sort((a, b) => a.localeCompare(b))

    const sameLen = next.length === this.meshSeeds.length
    let same = sameLen
    if (same) {
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== this.meshSeeds[i]) { same = false; break }
      }
    }

    if (!same) {
      this.meshSeeds = next
      this.meshSeedsRev++
    }
  }

  public publishExplicitSeedList = async (seeds: string[]): Promise<boolean> => {
    const lineage = this.resolve<any>('lineage')
    const mesh = this.tryGetMesh()
    if (!lineage || !mesh || typeof mesh.publish !== 'function') return false

    const signatureLocation = await this.computeSignatureLocation(lineage)
    if (!signatureLocation.sig) return false

    const normalized = Array.isArray(seeds)
      ? seeds.map(s => String(s ?? '').trim()).filter(s => s.length > 0)
      : []

    const payload = normalized.join(',')
    const ok = await mesh.publish(29010, signatureLocation.sig, payload, [['publisher', this.publisherId]])

    await this.refreshMeshSeeds()
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
    // key = space/domain/path/secret/seed (empty segments omitted)
    const parts = [this.#space, domain, lineagePath, this.#secret, 'seed'].filter(Boolean)
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


  private publishLocalSeeds = async (lineage: any, mesh: MeshApi, sig: string, grammar: string = ''): Promise<void> => {
    if (typeof mesh.publish !== 'function') return
    if (!lineage?.explorerDir) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    const localSeeds = await this.listSeedFolders(dir)
    const previousSeeds = this.lastLocalSeedsBySig.get(sig) ?? []

    // 1) one snapshot post per signature: full array of items
    if (!this.snapshotPostedBySig.has(sig)) {
      await mesh.publish(29010, sig, {
        seeds: localSeeds,
        publisherId: this.publisherId,
        mode: 'snapshot',
        publishedAtMs: Date.now()
      }, [['publisher', this.publisherId], ['mode', 'snapshot']])
      this.snapshotPostedBySig.add(sig)
      this.#lastRefreshAtMs.set(sig, Date.now())
    }

    // 2) thereafter post only newly added single items
    const prevSet = new Set(previousSeeds)
    for (const seed of localSeeds) {
      if (prevSet.has(seed)) continue
      await mesh.publish(29010, sig, seed, [['publisher', this.publisherId], ['mode', 'delta']])
    }

    this.lastLocalSeedsBySig.set(sig, localSeeds)

    // 3) periodic refresh (lease renewal) — re-publish full seed list so late joiners see tiles
    const now = Date.now()
    const lastRefresh = this.#lastRefreshAtMs.get(sig) ?? 0
    const refreshInterval = this.#computeRefreshInterval(mesh, sig)
    if (lastRefresh > 0 && (now - lastRefresh) >= refreshInterval) {
      await mesh.publish(29010, sig, {
        seeds: localSeeds,
        publisherId: this.publisherId,
        mode: 'refresh',
        publishedAtMs: now
      }, [['publisher', this.publisherId], ['mode', 'refresh']])
      this.#lastRefreshAtMs.set(sig, now)
    }

    const grammarSeed = this.toGrammarSeed(grammar)
    const grammarIsNew = grammarSeed && (sig !== this.lastPublishedGrammarSig || grammarSeed !== this.lastPublishedGrammarSeed)
    if (grammarIsNew) {
      await mesh.publish(29010, sig, grammarSeed, [['publisher', this.publisherId], ['source', 'show-honeycomb:grammar-heartbeat']])

      this.lastPublishedGrammarSig = sig
      this.lastPublishedGrammarSeed = grammarSeed
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

    // republish current local seeds as snapshot
    const localSeeds = this.lastLocalSeedsBySig.get(sig) ?? []
    if (localSeeds.length === 0) return

    void mesh.publish(29010, sig, {
      seeds: localSeeds,
      publisherId: this.publisherId,
      mode: 'snapshot',
      publishedAtMs: now
    }, [['publisher', this.publisherId], ['mode', 'snapshot']])

    // reset refresh timer since we just published
    this.#lastRefreshAtMs.set(sig, now)
  }

  private addCsvSeeds = (set: Set<string>, raw: string): void => {
    const text = String(raw ?? '').trim()
    if (!text) return

    const parts = text.split(',')
    for (const part of parts) {
      const seed = String(part ?? '').trim()
      if (seed) set.add(seed)
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

  private extractSeedsFromEventContent = (content: any): string[] => {
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
        const seeds = (parsed as any).seeds
        if (Array.isArray(seeds)) {
          for (const x of seeds) out.push(...this.splitCsv(String(x ?? '')))
        }

        const seed = String((parsed as any).seed ?? '').trim()
        if (seed) out.push(...this.splitCsv(seed))
        return out
      }
    } catch {
      // tolerant fallback for non-strict object-like payloads:
      // {seeds:[hello2,world2],pubs:123}
      const seedsMatch = raw.match(/seeds\s*:\s*\[([^\]]*)\]/i)
      if (seedsMatch && seedsMatch[1]) {
        return this.splitCsv(String(seedsMatch[1] ?? ''))
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
      let seed = String(part ?? '').trim()
      if (seed.startsWith('"') && seed.endsWith('"') && seed.length >= 2) {
        seed = seed.slice(1, -1).trim()
      }
      if (seed.startsWith("'") && seed.endsWith("'") && seed.length >= 2) {
        seed = seed.slice(1, -1).trim()
      }
      if (seed) out.push(seed)
    }
    return out
  }

  private toGrammarSeed = (grammar: string): string => {
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
    if (!axial?.items || !this.cachedSeedNames || !this.cachedLocalSeedSet) {
      this.requestRender()
      return
    }

    const seedNames = this.cachedSeedNames
    const localSeedSet = this.cachedLocalSeedSet
    const branchSet = this.cachedBranchSet ?? new Set<string>()

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : seedNames.length
    const effectiveLen = this.moveNames ? this.moveNames.length : seedNames.length
    const maxCells = Math.min(effectiveLen, axialMax)
    if (maxCells <= 0) return

    const cells = this.buildCellsFromAxial(axial, seedNames, maxCells, localSeedSet, branchSet)
    if (cells.length === 0) return

    // reuse cached image sigs (no OPFS read needed)
    for (const cell of cells) {
      if (this.seedImageCache.has(cell.label)) {
        cell.imageSig = this.seedImageCache.get(cell.label) ?? undefined
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
    // — skips ALL OPFS reads (explorerDir, listSeedFolders, checkHasBranch, history, layout)
    if (locationKey !== this.renderedLocationKey && this.#layerCellsCache.has(locationKey)) {
      const cached = this.#layerCellsCache.get(locationKey)!

      // ensure layer + atlases are initialized
      if (!this.layer) {
        this.layer = new Container()
        this.pixiContainer.addChild(this.layer)
        this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
        this.atlas.setPivot(this.#pivot)
        this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8)
        this.seedImageCache.clear()
        this.seedBorderColorCache.clear()
        this.seedTagsCache.clear()
        this.seedLinkCache.clear()
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
      this.cachedSeedNames = cached.seedNames
      this.cachedLocalSeedSet = cached.localSeedSet
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
      this.seedImageCache.clear()
      this.seedBorderColorCache.clear()
      this.atlasRenderer = this.pixiRenderer
      this.shader = null
    } else if (!this.atlas || this.atlasRenderer !== this.pixiRenderer) {
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
      this.atlas.setPivot(this.#pivot)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8)
      this.seedImageCache.clear()
      this.seedBorderColorCache.clear()
      this.atlasRenderer = this.pixiRenderer
      this.shader = null
    }

    const fsRev = Number(lineage.changed?.() ?? 0)
    const meshRev = this.meshSeedsRev

    const isStale = (): boolean => {
      const currentKey = String(lineage.explorerLabel?.() ?? '/')
      const currentRev = Number(lineage.changed?.() ?? 0)
      const currentMeshRev = this.meshSeedsRev
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
      const seedNames = flatResults.map(r => r.label)
      const flatSeedSet = new Set(seedNames)

      const axial = this.resolve<any>('axial')
      if (!axial) { this.rendering = false; return }

      const maxCells = Math.min(seedNames.length, typeof axial.items.size === 'number' ? axial.items.size : seedNames.length)
      const cells = this.buildCellsFromAxial(axial, seedNames, maxCells, flatSeedSet)
      if (cells.length === 0) { this.clearMesh(); this.rendering = false; return }

      // load images from the first matching dir (best-effort)
      await this.loadCellImages(cells, dir!)

      this.cachedSeedNames = seedNames
      this.cachedLocalSeedSet = flatSeedSet
      this.cachedBranchSet = new Set()
      this.renderedCellsKey = 'tag-flatten:' + [...this.filterTags].sort().join(',')
      this.renderedLocationKey = locationKey

      this.renderedCells.clear()
      for (const cell of cells) this.renderedCells.set(cell.label, cell)
      await this.applyGeometry(cells)

      this.#emitRenderTags(cells)
      this.emitEffect('render:cell-count', { count: cells.length, labels: seedNames })
      this.rendering = false
      return
    }

    // note: seed collection — always fresh, never cached
    const localSeeds = await this.listSeedFolders(dir)
    if (isStale()) {
      this.renderQueued = true
      return
    }

    // note: union with mesh seeds (shared)
    const union = new Set<string>()
    for (const s of localSeeds) union.add(s)
    for (const s of this.meshSeeds) union.add(s)

    const localSeedSet = new Set(localSeeds)

    // detect which local seeds have children (branches)
    const branchSet = new Set<string>()
    await Promise.all(localSeeds.map(async (name) => {
      if (await this.checkHasBranch(dir, name)) branchSet.add(name)
    }))

    // note: apply history — filter out seeds whose last operation is "remove"
    // When a cursor is rewound, also compute divergence (future adds/removes)
    // Skip when clipboard view is active — clipboard labels are authoritative
    const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    const cursorService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
    this.#divergenceFutureAdds = new Set<string>()
    this.#divergenceFutureRemoves = new Set<string>()
    if (!this.#clipboardView && historyService) {
      const sig = await this.computeSignatureLocation(lineage)

      // Load cursor for this location (keeps cursor position if already set)
      if (cursorService) await cursorService.load(sig.sig)

      const cursorState = cursorService?.state
      const isRewound = cursorState?.rewound ?? false

      if (isRewound && cursorService) {
        // Rewound: use cursor's divergence computation
        const divergence = cursorService.computeDivergence()
        // Remove seeds not in current set
        for (const seed of [...union]) {
          if (!divergence.current.has(seed) && !divergence.futureAdds.has(seed)) {
            union.delete(seed)
          }
        }
        // Add future-add seeds back to union (they'll render as ghosts)
        for (const seed of divergence.futureAdds) union.add(seed)
        this.#divergenceFutureAdds = divergence.futureAdds
        this.#divergenceFutureRemoves = divergence.futureRemoves
      } else {
        // Not rewound: standard replay — filter out removed seeds
        const ops = await historyService.replay(sig.sig)
        const seedState = new Map<string, string>()
        for (const op of ops) seedState.set(op.seed, op.op)
        for (const [seed, lastOp] of seedState) {
          if (lastOp === 'remove') union.delete(seed)
        }
      }
    }

    // filter out blocked external tiles and hidden local tiles before ordering
    const blockedSet = new Set<string>(JSON.parse(localStorage.getItem(`hc:blocked-tiles:${locationKey}`) ?? '[]'))
    for (const blocked of blockedSet) {
      if (!localSeedSet.has(blocked)) union.delete(blocked)
    }

    const hiddenSet = new Set<string>(JSON.parse(localStorage.getItem(`hc:hidden-tiles:${locationKey}`) ?? '[]'))
    this.#currentHiddenSet = hiddenSet
    if (!this.#showHiddenItems) {
      for (const hidden of hiddenSet) {
        if (localSeedSet.has(hidden)) union.delete(hidden)
      }
    }

    // clipboard view: show only clipboard labels
    if (this.#clipboardView) {
      const clipLabels = this.#clipboardView.labels
      for (const seed of union) {
        if (!clipLabels.has(seed)) union.delete(seed)
      }
    }

    // read layout mode for this location
    this.#layoutMode = this.#readLayoutMode(locationKey)

    let seedNames: string[]

    if (this.#layoutMode === 'pinned') {
      // pinned mode: each seed renders at its stored index position (gaps allowed)
      seedNames = await this.#orderByIndexPinned(dir, Array.from(union), localSeedSet)

      // apply search filter — blank out non-matching slots (preserve positions)
      if (this.filterKeyword) {
        const kw = this.filterKeyword
        seedNames = seedNames.map(s => s && s.toLowerCase().includes(kw) ? s : '')
      }
    } else {
      // dense mode: pack tiles contiguously using persisted order or index+offset sort
      const orderProjection = (window as any).ioc?.get?.('@diamondcoreprocessor.com/OrderProjection') as
        { hydrate(sig: string): Promise<string[]> } | undefined
      if (orderProjection) {
        const locSig = await this.computeSignatureLocation(lineage)
        const order = await orderProjection.hydrate(locSig.sig)
        if (order.length > 0) {
          const unionSet = new Set(union)
          seedNames = order.filter(s => unionSet.has(s))
          // append new seeds not yet in persisted order
          for (const s of union) {
            if (!seedNames.includes(s)) seedNames.push(s)
          }
        } else {
          seedNames = await this.#orderByIndex(dir, Array.from(union), localSeedSet)
        }
      } else {
        seedNames = await this.#orderByIndex(dir, Array.from(union), localSeedSet)
      }

      // apply layout ordering if a __layout__ file exists
      const layout = this.resolve<any>('layout')
      if (layout) {
        const order = await layout.read(dir)
        if (order) seedNames = layout.merge(order, seedNames)
      }

      // apply search filter if active
      if (this.filterKeyword) {
        const kw = this.filterKeyword
        seedNames = seedNames.filter((s: string) => s.toLowerCase().includes(kw))
      }
    }

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

      // apply saved viewport (or defaults) so the container is correct before tiles render
      await this.#applyViewportForLayer(dir)

      // sync VP directory so subsequent pan/zoom writes persist to the correct layer
      const vp = (window as any).ioc?.get?.('@diamondcoreprocessor.com/ViewportPersistence') as ViewportPersistence | undefined
      if (vp) vp.setDirSilent(dir)

      if (seedNames.length === 0) {
        if (this.layer) this.layer.visible = true
        this.clearMesh()
        return
      }

      // hide layer until streaming completes — prevents flash/jump during progressive render
      if (this.layer) this.layer.visible = false

      // emit navigation guard so click handlers block during transition
      this.emitEffect('navigation:guard-start', { locationKey })

      // stream seeds progressively (async, non-blocking)
      void this.streamSeeds(dir, seedNames, localSeedSet, axial, branchSet)
      return
    }

    // note: same layer — incremental path (seed collection was fresh, images are cached)
    if (seedNames.length === 0) {
      this.clearMesh()
      return
    }

    const wasEmpty = this.renderedCount === 0

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : seedNames.length
    const maxCells = Math.min(seedNames.length, axialMax)
    if (maxCells <= 0) {
      this.clearMesh()
      return
    }

    const cells = this.buildCellsFromAxial(axial, seedNames, maxCells, localSeedSet, branchSet)
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
    this.cachedSeedNames = seedNames
    this.cachedLocalSeedSet = localSeedSet
    this.cachedBranchSet = branchSet

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    await this.applyGeometry(cells)

    // first tile on empty screen → center viewport and zoom 2×
    if (wasEmpty && cells.length > 0 && this.pixiApp && this.pixiContainer && this.pixiRenderer) {
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
    this.#layerCellsCache.set(locationKey, { cells: [...cells], seedNames, localSeedSet, branchSet })
  }

  private readonly streamSeeds = async (
    dir: FileSystemDirectoryHandle,
    seedNames: string[],
    localSeedSet: Set<string>,
    axial: any,
    branchSet?: Set<string>,
  ): Promise<void> => {
    this.streamActive = true
    this.cancelStreamFlag = false

    const cells: SeedCell[] = []

    for (let index = 0; index < seedNames.length; index++) {
      if (this.cancelStreamFlag) break

      const label = seedNames[index]
      const axialCell = axial.items.get(index) as Axial | undefined
      if (!axialCell || !label) continue

      const div = this.#divergenceFutureAdds.has(label) ? 1 : this.#divergenceFutureRemoves.has(label) ? 2 : 0
      const cell: SeedCell = {
        q: axialCell.q,
        r: axialCell.r,
        label,
        external: !localSeedSet.has(label),
        hasBranch: branchSet?.has(label) ?? false,
        divergence: div,
      }

      await this.loadCellImages([cell], dir)
      if (this.cancelStreamFlag) break

      cells.push(cell)
      this.renderedCells.set(label, cell)

      const isLastSeed = index === seedNames.length - 1
      if (cells.length % ShowCellDrone.STREAM_BATCH_SIZE === 0 || isLastSeed) {
        await this.applyGeometry(cells, isLastSeed)
      }

      await this.microDelay()
    }

    // only reveal the layer if this stream was not cancelled by a newer navigation
    if (!this.cancelStreamFlag && this.layer) this.layer.visible = true

    this.streamActive = false
    this.emitEffect('navigation:guard-end', {})

    // cache for instant back-navigation
    if (!this.cancelStreamFlag && cells.length > 0) {
      const locKey = this.renderedLocationKey
      this.#layerCellsCache.set(locKey, { cells: [...cells], seedNames, localSeedSet, branchSet: branchSet ?? new Set() })
    }

    this.requestRender()
  }

  readonly #applyViewportForLayer = async (dir: FileSystemDirectoryHandle): Promise<void> => {
    const container = this.pixiContainer
    const app = this.pixiApp
    const renderer = this.pixiRenderer
    if (!container || !app || !renderer) return

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
  }

  private readonly applyGeometry = async (cells: SeedCell[], final = true): Promise<void> => {
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
      linkLabels: cells.filter(cell => cell.hasLink).map(cell => cell.label),
    })
    this.#emitRenderTags(cells)
  }

  /** Emit render:tags with unique tag names + counts from all currently visible cells. */
  #emitRenderTags(cells: SeedCell[]): void {
    const counts = new Map<string, number>()
    for (const cell of cells) {
      const tags = this.seedTagsCache.get(cell.label)
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

  private ensureListeners = (): void => {
    if (this.listening) return
    this.listening = true

    // respond to processor-emitted synchronize and URL navigation
    window.addEventListener('synchronize', this.requestRender)
    window.addEventListener('navigate', this.requestRender)

    // tile:saved effect — invalidate image cache for the specific seed so re-render picks up new image
    this.onEffect<{ seed: string }>('tile:saved', (payload) => {
      if (payload?.seed) {
        const oldSig = this.seedImageCache.get(payload.seed)
        this.seedImageCache.delete(payload.seed)
        this.seedBorderColorCache.delete(payload.seed)
        this.seedTagsCache.delete(payload.seed)
        this.seedLinkCache.delete(payload.seed)
        if (oldSig && this.imageAtlas) {
          this.imageAtlas.invalidate(oldSig)
        }
      }
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // tags:changed effect — invalidate tag cache for affected seeds and re-emit render:tags
    this.onEffect<{ updates: { seed: string }[] }>('tags:changed', (payload) => {
      if (!payload?.updates) return
      for (const { seed } of payload.updates) {
        this.seedTagsCache.delete(seed)
      }
      this.#layerCellsCache.delete(this.renderedLocationKey)
      this.renderedCellsKey = ''
      this.requestRender()
    })

    // seed:added / seed:removed — invalidate render cache so next synchronize picks up new tile set
    this.onEffect<{ seed: string }>('seed:added', () => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
    })

    this.onEffect<{ seed: string }>('seed:removed', () => {
      this.#layerCellsCache.clear()
      this.renderedCellsKey = ''
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
      if (payload && this.cachedSeedNames) {
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
        this.seedImageCache.clear()
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

    // clipboard:view effect — filter visible seeds to clipboard contents
    this.onEffect<{ active: boolean; labels?: string[]; sourceSegments?: string[] }>('clipboard:view', (payload) => {
      if (payload?.active && payload.labels) {
        this.#clipboardView = {
          labels: new Set(payload.labels),
          sourceSegments: payload.sourceSegments ?? [],
        }
      } else {
        this.#clipboardView = null
      }
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

    // seed from persisted stores so secret/room survive page reload
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

    // listen for public/private toggle — clear mesh seeds when going private so
    // external tiles disappear immediately without requiring a manual refresh
    this.onEffect<{ public: boolean }>('mesh:public-changed', ({ public: isPublic }) => {
      if (!isPublic) {
        this.meshSeeds = []
        this.meshSeedsRev++
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
        this.renderedCellsKey = ''
        this.requestRender()
      }
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

    this.onEffect<{ seed: string; index: number }>('seed:place-at', (payload) => {
      void this.#handlePlaceAt(payload.seed, payload.index)
    })

    this.onEffect<{ labels: string[] }>('seed:reorder', (payload) => {
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
          hoverTags = this.seedTagsCache.get(label) ?? []
          break
        }
      }
      this.emitEffect('tile:hover-tags', { tags: hoverTags })
    })

    ; (window as any).showCellsPoc = {
      publishSeeds: async (seeds: string[]) => this.publishExplicitSeedList(seeds),
      signature: async () => {
        const lineage = this.resolve<any>('lineage')
        return await this.computeSignatureLocation(lineage)
      }
    }
  }

  protected override dispose = (): void => {
    window.removeEventListener('synchronize', this.requestRender)
    window.removeEventListener('navigate', this.requestRender)

    if (this.lineageChangeListening) {
      const lineage = this.resolve<EventTarget>('lineage')
      lineage?.removeEventListener('change', this.onLineageChange)
      this.lineageChangeListening = false
    }
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
    this.cachedSeedNames = null
    this.cachedLocalSeedSet = null
    this.cachedBranchSet = null
    this.emitEffect('render:cell-count', { count: 0, labels: [] })
  }

  private readonly rebuildRenderResources = (renderer: unknown): void => {
    this.clearMesh()
    this.shader = null
    this.atlas = new HexLabelAtlas(renderer, 128, 8, 8)
    this.imageAtlas = new HexImageAtlas(renderer, 256, 8, 8)
    this.seedImageCache.clear()
    this.atlasRenderer = renderer
  }

  private listSeedFolders = async (dir: FileSystemDirectoryHandle): Promise<string[]> => {
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

  async #orderByIndexPinned(dir: FileSystemDirectoryHandle, names: string[], localSeedSet: Set<string>): Promise<string[]> {
    const axial = this.resolve<any>('axial')
    const maxSlot = axial?.count ?? 60
    const sparse: string[] = new Array(maxSlot + 1).fill('')

    let nextFree = 0
    const unindexed: string[] = []

    for (const name of names) {
      if (!localSeedSet.has(name)) {
        unindexed.push(name)
        continue
      }
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readSeedProperties(seedDir)
        if (typeof props['index'] === 'number') {
          const idx = props['index'] as number
          if (idx >= 0 && idx <= maxSlot) {
            sparse[idx] = name
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

    // place unindexed seeds in the first available empty slots
    for (const name of unindexed) {
      while (nextFree <= maxSlot && sparse[nextFree] !== '') nextFree++
      if (nextFree <= maxSlot) {
        sparse[nextFree] = name
        // persist the assigned index
        if (localSeedSet.has(name)) {
          try {
            const seedDir = await dir.getDirectoryHandle(name, { create: false })
            await writeSeedProperties(seedDir, { index: nextFree, offset: 0 })
          } catch { /* skip */ }
        }
        nextFree++
      }
    }

    return sparse
  }

  /**
   * Order seeds by their persisted index in the 0000 properties file.
   * Seeds without an index get the next available index and are written back.
   * External (mesh) seeds are always re-indexed locally.
   */
  async #orderByIndex(dir: FileSystemDirectoryHandle, names: string[], localSeedSet: Set<string>): Promise<string[]> {
    const indexed: { name: string; position: number }[] = []
    const unindexed: string[] = []
    let maxIndex = -1

    for (const name of names) {
      if (!localSeedSet.has(name)) {
        unindexed.push(name)
        continue
      }
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readSeedProperties(seedDir)
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

    // assign next available permanent index to unindexed seeds
    let nextIndex = maxIndex + 1
    if (indexed.length === 0) {
      unindexed.sort((a, b) => a.localeCompare(b))
    }

    for (const name of unindexed) {
      const assignedIndex = nextIndex++
      // new tiles: index = permanent, offset = 0 → position = index
      indexed.push({ name, position: assignedIndex })

      if (localSeedSet.has(name)) {
        try {
          const seedDir = await dir.getDirectoryHandle(name, { create: false })
          await writeSeedProperties(seedDir, { index: assignedIndex, offset: 0 })
        } catch { /* seed dir missing — skip */ }
      }
    }

    // re-sort after appending new seeds
    indexed.sort((a, b) => a.position - b.position)
    return indexed.map(s => s.name)
  }

  async #handlePlaceAt(seed: string, targetIndex: number): Promise<void> {
    const lineage = this.resolve<any>('lineage')
    if (!lineage) return
    const dir = await lineage.explorerDir() as FileSystemDirectoryHandle | null
    if (!dir) return

    // read all local seeds and their current indices
    const localSeeds = await this.listSeedFolders(dir)
    const entries: { name: string; index: number }[] = []

    for (const name of localSeeds) {
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readSeedProperties(seedDir)
        entries.push({ name, index: typeof props['index'] === 'number' ? props['index'] as number : entries.length })
      } catch {
        entries.push({ name, index: entries.length })
      }
    }

    entries.sort((a, b) => a.index - b.index)

    // remove seed if already present, then insert at target
    const names = entries.map(e => e.name).filter(n => n !== seed)
    const clamped = Math.max(0, Math.min(targetIndex, names.length))
    names.splice(clamped, 0, seed)

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
        const seedDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readSeedProperties(seedDir)
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
        const seedDir = await dir.getDirectoryHandle(name, { create: false })
        await writeSeedProperties(seedDir, { index: permanentIndex, offset })
      } catch { /* skip missing seed dirs */ }
    }
  }

  private checkHasBranch = async (parentDir: FileSystemDirectoryHandle, seedName: string): Promise<boolean> => {
    try {
      const seedDir = await parentDir.getDirectoryHandle(seedName, { create: false })
      for await (const [name, handle] of seedDir.entries()) {
        if (handle.kind === 'directory' && !name.startsWith('__')) return true
      }
    } catch { /* seed doesn't exist or can't be read */ }
    return false
  }

  private buildCellsFromAxial = (axial: any, names: string[], max: number, localSeedSet: Set<string>, branchSet?: Set<string>): SeedCell[] => {
    const out: SeedCell[] = []
    // during move drag, use reordered names so labels map to correct indices
    const effectiveNames = this.moveNames ?? names

    for (let i = 0; i < max; i++) {
      const a = axial.items.get(i) as Axial | undefined
      const label = effectiveNames[i] ?? names[i]
      if (!a) break
      if (!label) continue

      const div = this.#divergenceFutureAdds.has(label) ? 1 : this.#divergenceFutureRemoves.has(label) ? 2 : 0
      out.push({ q: a.q, r: a.r, label, external: !localSeedSet.has(label), heat: this.#heatByLabel.get(label) ?? 0, hasBranch: branchSet?.has(label) ?? false, divergence: div })
    }

    return out
  }

  /**
   * Load cell properties from the content-addressed tile-props index
   * and resolve the small.image signature from __resources__/ into the image atlas.
   * Standard: any property value matching a 64-char hex signature
   * refers to a blob in __resources__/{signature}.
   */
  private loadCellImages = async (cells: SeedCell[], _dir: FileSystemDirectoryHandle): Promise<void> => {
    const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as
      { getResource: (sig: string) => Promise<Blob | null> } | undefined
    if (!store || !this.imageAtlas) return

    const propsIndex: Record<string, string> = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')

    for (const cell of cells) {
      // external seeds don't have local OPFS data
      if (cell.external) continue

      // load tags + link from OPFS if not cached (independent of image cache)
      if (!this.seedTagsCache.has(cell.label)) {
        try {
          const seedDir = await _dir.getDirectoryHandle(cell.label)
          const tagProps = await readSeedProperties(seedDir)
          const rawTags = tagProps?.['tags']
          this.seedTagsCache.set(cell.label, Array.isArray(rawTags)
            ? (rawTags as unknown[]).filter((t): t is string => typeof t === 'string')
            : [])
          if (!this.seedLinkCache.has(cell.label)) {
            this.seedLinkCache.set(cell.label, typeof tagProps?.['link'] === 'string' && (tagProps['link'] as string).length > 0)
          }
        } catch { this.seedTagsCache.set(cell.label, []) }
      }

      // check cache first
      if (this.seedImageCache.has(cell.label)) {
        cell.imageSig = this.seedImageCache.get(cell.label) ?? undefined
        cell.borderColor = this.seedBorderColorCache.get(cell.label)
        cell.hasLink = this.seedLinkCache.get(cell.label) ?? false
        continue
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
          this.seedBorderColorCache.set(cell.label, [r, g, b])
        }

        // extract tags from properties
        const cellTags = props?.['tags']
        if (Array.isArray(cellTags)) {
          this.seedTagsCache.set(cell.label, cellTags.filter((t: unknown) => typeof t === 'string'))
        } else {
          this.seedTagsCache.set(cell.label, [])
        }

        // extract link presence
        const hasLink = typeof props?.link === 'string' && props.link.length > 0
        this.seedLinkCache.set(cell.label, hasLink)
        cell.hasLink = hasLink

        const smallSig = (this.#flat && props?.flat?.small?.image) || props?.small?.image
        if (smallSig && isSignature(smallSig)) {
          cell.imageSig = smallSig
          this.seedImageCache.set(cell.label, smallSig)

          // load blob into image atlas if not already there
          if (!this.imageAtlas.hasImage(smallSig)) {
            const blob = await store.getResource(smallSig)
            if (blob) {
              await this.imageAtlas.loadImage(smallSig, blob)
            }
          }
        } else {
          this.seedImageCache.set(cell.label, null)
        }
      } catch {
        // no seed dir or no properties file — no image
        this.seedImageCache.set(cell.label, null)
      }
    }
  }

  private buildCellsKey = (cells: SeedCell[]): string => {
    const selectionService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SelectionService') as
      { isSelected: (label: string) => boolean } | undefined
    let s = `p${this.#pivot ? 1 : 0}f${this.#flat ? 1 : 0}|`
    for (const c of cells) s += `${c.q},${c.r}:${c.label}:${c.external ? 1 : 0}:${c.imageSig ?? ''}:${c.hasBranch ? 1 : 0}:${c.divergence ?? 0}|`
    return s
  }

  private axialToPixel = (q: number, r: number, s: number, flat = false) => flat
    ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
    : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }

  private buildFillQuadGeometry(cells: SeedCell[], r: number, gap: number, hw: number, hh: number): Geometry {
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

      // cell image atlas UVs (suppressed in text-only mode)
      const imgUV = !this.#textOnly && c.imageSig ? this.imageAtlas?.getImageUV(c.imageSig) ?? null : null
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