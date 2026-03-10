// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/show-honeycomb.drone.ts
// upgrade: heartbeat derives signed sig(domain/segment(s)/seed), pulls non-expired mesh items, unions with local seeds, and renders as tiles
// - expiry rules are owned by NostrMeshDrone
// - union keeps filesystem seeds as your own local truth, mesh adds shared seeds
// - redraw stays event-driven via synchronize, but heartbeat also triggers synchronize

import { Drone, SignatureService, SignatureStore } from '@hypercomb/core'
import { Application, Assets, Container, Geometry, Mesh, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.drone.js'
import { HexLabelAtlas } from './hex-label.atlas.js'
import { HexImageAtlas } from './hex-image.atlas.js'
import { HexSdfTextureShader } from './hex-sdf.shader.js'
import { TILE_PROPERTIES_FILE, isSignature } from '../editor/tile-properties.js'
import { computeLineageSig } from '@hypercomb/core'

type Axial = { q: number; r: number }
type SeedCell = { q: number; r: number; label: string; external: boolean; imageSig?: string; heat?: number }

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
  publish?: (kind: number, sig: string, payload: any, extraTags?: string[][]) => Promise<boolean>
  subscribe?: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
}

type PixiHostApi = {
  app?: Application | null
  container?: Container | null
}

export class ShowHoneycombWorker extends Drone {
  private static readonly STREAM_BATCH_SIZE = 8

  readonly namespace = 'diamondcoreprocessor.com'
  // pixi resources (populated via render:host-ready effect)
  private pixiApp: Application | null = null
  private pixiContainer: Container | null = null
  private pixiRenderer: Application['renderer'] | null = null

  private layer: Container | null = null
  private hexMesh: any | null = null

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    axial: '@diamondcoreprocessor.com/AxialService',
  }

  protected override listens = ['render:host-ready', 'mesh:ready', 'mesh:items-updated', 'tile:saved']
  protected override emits = ['mesh:ensure-started', 'mesh:subscribe', 'mesh:publish', 'render:mesh-offset', 'render:cell-count']
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private readonly texByUrl = new Map<string, Texture>()
  private atlas: HexLabelAtlas | null = null
  private imageAtlas: HexImageAtlas | null = null
  private atlasRenderer: unknown = null

  // cache: seed label → small image signature (avoids re-reading 0000 on every render)
  private readonly seedImageCache = new Map<string, string | null>()

  private lastKey = ''

  private listening = false
  private rendering = false
  private renderQueued = false

  private renderedCellsKey = ''
  private renderedCount = 0

  private lineageChangeListening = false

  // incremental rendering state — tracks what's currently painted (geometry cache)
  private readonly renderedCells = new Map<string, SeedCell>()
  #heatByLabel = new Map<string, number>()
  private streamActive = false
  private cancelStreamFlag = false
  private renderedLocationKey = ''

  // note: mesh seed state (derived on heartbeat)
  private meshSig = ''
  private meshSeedsRev = 0
  private meshSeeds: string[] = []
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

    // listen for pixi host readiness via effect bus
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.pixiApp = payload.app
      this.pixiContainer = payload.container
      this.pixiRenderer = payload.renderer
      this.requestRender()
    })

    // note: always compute mesh seeds on every heartbeat
    await this.refreshMeshSeeds(grammar)

    // note: live heartbeat path; no bootstrap short-circuit
    this.requestRender()
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
        this.meshSub = mesh.subscribe(sig, () => {
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

  private computeSignatureLocation = async (lineage: any): Promise<{ key: string; sig: string }> => {
    const domain = String(lineage?.domain?.() ?? lineage?.domainLabel?.() ?? 'hypercomb.io')
    const explorerSegmentsRaw = lineage?.explorerSegments?.()
    const explorerSegments = Array.isArray(explorerSegmentsRaw)
      ? explorerSegmentsRaw
        .map((x: unknown) => String(x ?? '').trim())
        .filter((x: string) => x.length > 0)
      : []

    const lineagePath = explorerSegments.join('/')
    const key = lineagePath ? `${domain}/${lineagePath}/seed` : `${domain}/seed`
    // use SignatureStore.signText() for memoization — same lineage path = same sig
    const sigStore = get<SignatureStore>('@hypercomb/SignatureStore')
    const sig = sigStore
      ? await sigStore.signText(key)
      : await SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer)

    return { key, sig }
  }

  // mesh discovery — resolves whichever mesh drone is registered
  // note: data queries (getNonExpired, subscribe) still use the direct API
  // coordination (ensureStartedForSig, publish) also emits effects for observability
  private tryGetMesh = (): MeshApi | null => {
    return get<MeshApi>('@diamondcoreprocessor.com/NostrMeshWorker') ?? null
  }


  private publishLocalSeeds = async (lineage: any, mesh: MeshApi, sig: string, grammar: string = ''): Promise<void> => {
    if (typeof mesh.publish !== 'function') return

    const localSeeds = await this.getChildNames()
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
    }

    // 2) thereafter post only newly added single items
    const prevSet = new Set(previousSeeds)
    for (const seed of localSeeds) {
      if (prevSet.has(seed)) continue
      await mesh.publish(29010, sig, seed, [['publisher', this.publisherId], ['mode', 'delta']])
    }

    this.lastLocalSeedsBySig.set(sig, localSeeds)

    const grammarSeed = this.toGrammarSeed(grammar)
    const grammarIsNew = grammarSeed && (sig !== this.lastPublishedGrammarSig || grammarSeed !== this.lastPublishedGrammarSeed)
    if (grammarIsNew) {
      await mesh.publish(29010, sig, grammarSeed, [['publisher', this.publisherId], ['source', 'show-honeycomb:grammar-heartbeat']])

      this.lastPublishedGrammarSig = sig
      this.lastPublishedGrammarSeed = grammarSeed
    }
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

  private readonly requestRender = (): void => {
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
  }

  private readonly renderFromSynchronize = async (): Promise<void> => {
    if (!this.pixiApp || !this.pixiContainer || !this.pixiRenderer) {
      this.clearMesh()
      return
    }

    // note: query mesh before building cells so first render includes latest shared seeds
    await this.refreshMeshSeeds()

    const axial = this.resolve<any>('axial')
    if (!axial?.items) {
      this.clearMesh()
      return
    }

    const lineage = this.resolve<any>('lineage')
    if (!lineage?.explorerLabel || !lineage?.changed) {
      this.clearMesh()
      return
    }

    // note: init layer + atlases (and reset shader if renderer changes)
    if (!this.layer) {
      this.layer = new Container()
      this.pixiContainer.addChild(this.layer)

      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8)
      this.atlasRenderer = this.pixiRenderer
      this.shader = null
    } else if (!this.atlas || this.atlasRenderer !== this.pixiRenderer) {
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8)
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8)
      this.atlasRenderer = this.pixiRenderer
      this.shader = null
    }

    const locationKey = String(lineage.explorerLabel?.() ?? '/')
    const fsRev = Number(lineage.changed?.() ?? 0)
    const meshRev = this.meshSeedsRev

    const isStale = (): boolean => {
      const currentKey = String(lineage.explorerLabel?.() ?? '/')
      const currentRev = Number(lineage.changed?.() ?? 0)
      const currentMeshRev = this.meshSeedsRev
      return currentKey !== locationKey || currentRev !== fsRev || currentMeshRev !== meshRev
    }

    // note: your own seeds (live cache children)
    const localSeeds = await this.getChildNames()
    if (isStale()) {
      this.renderQueued = true
      return
    }

    // note: union with mesh seeds (shared)
    const union = new Set<string>()
    for (const s of localSeeds) union.add(s)
    for (const s of this.meshSeeds) union.add(s)

    const localSeedSet = new Set(localSeeds)
    const seedNames = Array.from(union)
    seedNames.sort((a, b) => a.localeCompare(b))
    const layerChanged = locationKey !== this.renderedLocationKey

    // note: if streaming is active for the same layer, let the stream finish
    if (this.streamActive && !layerChanged) return

    // note: layer changed — cancel active stream, start progressive streaming
    if (layerChanged) {
      this.cancelStreamFlag = true
      this.renderedLocationKey = locationKey
      this.renderedCells.clear()

      // emit navigation guard so click handlers block during transition
      this.emitEffect('navigation:guard-start', { locationKey })

      if (seedNames.length === 0) {
        this.clearMesh()
        this.emitEffect('navigation:guard-end', {})
        return
      }

      // stream seeds progressively (async, non-blocking)
      void this.streamSeeds(null, seedNames, localSeedSet, axial)
      return
    }

    // note: same layer — incremental path (seed collection was fresh, images are cached)
    if (seedNames.length === 0) {
      this.clearMesh()
      return
    }

    const axialMax = typeof axial.items.size === 'number' ? axial.items.size : seedNames.length
    const maxCells = Math.min(seedNames.length, axialMax)
    if (maxCells <= 0) {
      this.clearMesh()
      return
    }

    const cells = this.buildCellsFromAxial(axial, seedNames, maxCells, localSeedSet)
    if (cells.length === 0) {
      this.clearMesh()
      return
    }

    // note: load cell images from 0000 properties → __resources__/
    await this.loadCellImages(cells, null)
    if (isStale()) {
      this.renderQueued = true
      return
    }

    this.renderedCells.clear()
    for (const cell of cells) this.renderedCells.set(cell.label, cell)

    await this.applyGeometry(cells)
  }

  private readonly streamSeeds = async (
    dir: FileSystemDirectoryHandle | null,
    seedNames: string[],
    localSeedSet: Set<string>,
    axial: any,
  ): Promise<void> => {
    this.streamActive = true
    this.cancelStreamFlag = false

    const cells: SeedCell[] = []

    for (let index = 0; index < seedNames.length; index++) {
      if (this.cancelStreamFlag) break

      const label = seedNames[index]
      const axialCell = axial.items.get(index) as Axial | undefined
      if (!axialCell || !label) continue

      const cell: SeedCell = {
        q: axialCell.q,
        r: axialCell.r,
        label,
        external: !localSeedSet.has(label),
      }

      await this.loadCellImages([cell], dir)
      if (this.cancelStreamFlag) break

      cells.push(cell)
      this.renderedCells.set(label, cell)

      const isLastSeed = index === seedNames.length - 1
      if (cells.length % ShowHoneycombWorker.STREAM_BATCH_SIZE === 0 || isLastSeed) {
        await this.applyGeometry(cells)
      }

      await this.microDelay()
    }

    this.streamActive = false
    this.emitEffect('navigation:guard-end', {})
    this.requestRender()
  }

  private readonly applyGeometry = async (cells: SeedCell[]): Promise<void> => {
    if (cells.length === 0) {
      this.clearMesh()
      return
    }

    const circumRadiusPx = 32
    const gapPx = 6
    const padPx = 10

    const nextCellsKey = this.buildCellsKey(cells)
    if (nextCellsKey === this.renderedCellsKey && cells.length === this.renderedCount) {
      return
    }

    const hexHalfW = (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = circumRadiusPx
    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    const baseTex = await this.ensureTexture('/local.png')
    const externalTex = await this.ensureTexture('/external.png')
    if (!baseTex || !externalTex || !this.atlas || !this.imageAtlas) {
      this.clearMesh()
      return
    }

    const labelTex = this.atlas.getAtlasTexture()
    const cellImageTex = this.imageAtlas.getAtlasTexture()

    for (const cell of cells) this.atlas.getLabelUV(cell.label)

    const geom = this.buildFillQuadGeometry(cells, circumRadiusPx, gapPx, quadHalfW, quadHalfH)

    if (!this.shader) {
      this.shader = new HexSdfTextureShader(baseTex, externalTex, labelTex, cellImageTex, quadW, quadH, circumRadiusPx)
    } else {
      try {
        this.shader.setBaseTexture(baseTex)
        this.shader.setExternalTexture(externalTex)
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

    if (!this.hexMesh) {
      this.hexMesh = new Mesh({ geometry: geom as any, shader: (this.shader as any).shader, texture: baseTex as any } as any)
      this.layer!.addChild(this.hexMesh as any)
    } else {
      if (this.geom) this.geom.destroy(true)
      this.hexMesh.geometry = geom
      this.hexMesh.shader = (this.shader as any).shader
      if ('texture' in this.hexMesh) this.hexMesh.texture = baseTex
    }

    if (this.hexMesh?.getLocalBounds) {
      this.hexMesh.position.set(0, 0)
      const bounds = this.hexMesh.getLocalBounds()
      this.hexMesh.position.set(-(bounds.x + bounds.width * 0.5), -(bounds.y + bounds.height * 0.5))
      this.emitEffect('render:mesh-offset', { x: this.hexMesh.position.x, y: this.hexMesh.position.y })
    }

    this.geom = geom
    this.renderedCellsKey = nextCellsKey
    this.renderedCount = cells.length
    this.emitEffect('render:cell-count', {
      count: cells.length,
      labels: cells.map(cell => cell.label),
    })
  }

  // 1–3ms micro-pause to avoid main-thread blocking (legacy JsonHiveStreamLoader pattern)
  private readonly microDelay = (): Promise<void> =>
    new Promise(r => setTimeout(r, 1 + Math.random() * 2))

  private ensureListeners = (): void => {
    if (this.listening) return
    this.listening = true

    // respond to processor-emitted synchronize
    window.addEventListener('synchronize', () => this.requestRender())

    // tile:saved effect — invalidate image cache for the specific seed so re-render picks up new image
    this.onEffect<{ seed: string }>('tile:saved', (payload) => {
      if (payload?.seed) {
        const oldSig = this.seedImageCache.get(payload.seed)
        this.seedImageCache.delete(payload.seed)
        if (oldSig && this.imageAtlas) {
          this.imageAtlas.invalidate(oldSig)
        }
      }
      this.requestRender()
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
    window.removeEventListener('synchronize', this.onSynchronize)

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
    this.emitEffect('render:cell-count', { count: 0, labels: [] })
  }

  private readonly rebuildRenderResources = (renderer: unknown): void => {
    this.clearMesh()
    this.shader = null
    this.texByUrl.clear()
    this.atlas = new HexLabelAtlas(renderer, 128, 8, 8)
    this.imageAtlas = new HexImageAtlas(renderer, 256, 8, 8)
    this.seedImageCache.clear()
    this.atlasRenderer = renderer
  }

  private ensureTexture = async (url: string): Promise<Texture | null> => {
    const existing = this.texByUrl.get(url)
    if (existing) return existing

    const loaded = await Assets.load(url)
    this.texByUrl.set(url, loaded)
    return loaded
  }

  /**
   * Read child names from the live cache for the current lineage.
   * Each child's lineage resource (stored in __resources__/) contains
   * the JSON segments array; the last segment is the child's name.
   */
  private getChildNames = async (): Promise<string[]> => {
    const lineage = this.resolve<any>('lineage')
    const store = (window as any).ioc?.get?.('@hypercomb.social/Store')
    if (!lineage || !store) return []

    const layer = lineage.currentLayer?.()
    if (!layer) return []

    const childSigs: string[] = await store.getListResource(layer.children)
    const names: string[] = []

    for (const childSig of childSigs) {
      try {
        const blob = await store.getResource(childSig)
        if (!blob) continue
        const text = await blob.text()
        const segments = JSON.parse(text) as string[]
        const name = segments[segments.length - 1]
        if (name) names.push(name)
      } catch { /* skip */ }
    }

    names.sort((a, b) => a.localeCompare(b))
    return names
  }

  private buildCellsFromAxial = (axial: any, names: string[], max: number, localSeedSet: Set<string>): SeedCell[] => {
    const out: SeedCell[] = []

    for (let i = 0; i < max; i++) {
      const a = axial.items.get(i) as Axial | undefined
      const label = names[i]
      if (!a || !label) break
      out.push({ q: a.q, r: a.r, label, external: !localSeedSet.has(label), heat: this.#heatByLabel.get(label) ?? 0 })
    }

    return out
  }

  /**
   * Load cell properties (0000 file) for each local seed and resolve
   * the small.image signature from __resources__/ into the image atlas.
   * Standard: any property value matching a 64-char hex signature
   * refers to a blob in __resources__/{signature}.
   */
  private loadCellImages = async (cells: SeedCell[], dir: FileSystemDirectoryHandle | null): Promise<void> => {
    const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as
      { getResource: (sig: string) => Promise<Blob | null> } | undefined
    if (!store || !this.imageAtlas || !dir) return

    for (const cell of cells) {
      // external seeds don't have local OPFS data
      if (cell.external) continue

      // check cache first
      if (this.seedImageCache.has(cell.label)) {
        cell.imageSig = this.seedImageCache.get(cell.label) ?? undefined
        continue
      }

      // read 0000 properties file from the seed directory
      try {
        const seedDir = await dir.getDirectoryHandle(cell.label)
        const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE)
        const file = await fileHandle.getFile()
        const text = await file.text()
        const props = JSON.parse(text)

        // standard: small.image is a signature → resolve from __resources__/
        const smallSig = props?.small?.image
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
    let s = ''
    for (const c of cells) s += `${c.q},${c.r}:${c.label}:${c.external ? 1 : 0}:${c.imageSig ?? ''}|`
    return s
  }

  private axialToPixel = (q: number, r: number, s: number) => ({
    x: Math.sqrt(3) * s * (q + r / 2),
    y: s * 1.5 * r
  })

  private buildFillQuadGeometry(cells: SeedCell[], r: number, gap: number, hw: number, hh: number): Geometry {
    const spacing = r + gap

    const selectionService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SelectionService') as
      { isSelected: (label: string) => boolean } | undefined

    const pos = new Float32Array(cells.length * 8)
    const uv = new Float32Array(cells.length * 8)
    const labelUV = new Float32Array(cells.length * 16)
    const texKind = new Float32Array(cells.length * 4)
    const imageUV = new Float32Array(cells.length * 16)
    const hasImage = new Float32Array(cells.length * 4)
    const heat = new Float32Array(cells.length * 4)
    const identityColor = new Float32Array(cells.length * 12)
    const idx = new Uint32Array(cells.length * 6)

    let pv = 0, uvp = 0, luvp = 0, tkp = 0, iuvp = 0, hip = 0, hp = 0, icp = 0, ii = 0, base = 0

    for (const c of cells) {
      const { x, y } = this.axialToPixel(c.q, c.r, spacing)

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

      const kind = c.external ? 1 : 0
      texKind.set([kind, kind, kind, kind], tkp)
      tkp += 4

      // cell image atlas UVs
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

      const [cr, cg, cb] = labelToRgb(c.label)
      identityColor.set([cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb], icp)
      icp += 12

      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], ii)
      ii += 6
      base += 4
    }

    const g = new Geometry()
      ; (g as any).addAttribute('aPosition', pos, 2)
      ; (g as any).addAttribute('aUV', uv, 2)
      ; (g as any).addAttribute('aLabelUV', labelUV, 4)
      ; (g as any).addAttribute('aTexKind', texKind, 1)
      ; (g as any).addAttribute('aImageUV', imageUV, 4)
      ; (g as any).addAttribute('aHasImage', hasImage, 1)
      ; (g as any).addAttribute('aHeat', heat, 1)
      ; (g as any).addAttribute('aIdentityColor', identityColor, 3)
      ; (g as any).addIndex(idx)

    return g
  }
}

const _showHoneycomb = new ShowHoneycombWorker()
window.ioc.register('@diamondcoreprocessor.com/ShowHoneycombWorker', _showHoneycomb)