// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/show-honeycomb.drone.ts
// upgrade: heartbeat derives signed sig(domain-lineage-seed), pulls non-expired mesh items, unions with local seeds, and renders as tiles
// - expiry rules are owned by NostrMeshDrone
// - union keeps filesystem seeds as your own local truth, mesh adds shared seeds
// - redraw stays event-driven via synchronize, but heartbeat also triggers synchronize

import { Drone, SignatureService } from '@hypercomb/core'
import { Assets, Container, Geometry, Mesh, Texture } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone.js'
import { HexLabelAtlas } from './hex-label.atlas.js'
import { HexSdfTextureShader } from './hex-sdf.shader.js'

type Axial = { q: number; r: number }
type SeedCell = { q: number; r: number; label: string }

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshApi = { ensureStartedForSig: (sig: string) => void; getNonExpired: (sig: string) => MeshEvt[] }

export class ShowHoneycombDrone extends Drone {
  private host?: PixiHostDrone
  private layer: Container | null = null

  private mesh: any | null = null
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private tex: Texture | null = null
  private atlas: HexLabelAtlas | null = null
  private atlasRenderer: unknown = null

  private lastKey = ''

  private listening = false
  private rendering = false
  private renderQueued = false

  private renderedCellsKey = ''
  private renderedCount = 0

  // note: mesh seed state (derived on heartbeat)
  private meshSig = ''
  private meshSeedsRev = 0
  private meshSeeds: string[] = []

  protected override heartbeat = async (): Promise<void> => {
    this.ensureListeners()

    // note: always compute mesh seeds on every heartbeat
    await this.refreshMeshSeeds()

    // note: force redraw contract
    window.dispatchEvent(new CustomEvent('synchronize', { detail: { source: 'show-honeycomb:heartbeat' } }))

    // note: live heartbeat path; no bootstrap short-circuit
    this.requestRender()
  }

  private refreshMeshSeeds = async (): Promise<void> => {

    const lineage = window.ioc.get('Lineage') as any
    const mesh = window.ioc.get('NostrMeshDrone') as any as MeshApi
    if (!lineage || !mesh) return

    // note: domain-lineage-seed discriminator
    const domain = String(lineage?.domain?.() ?? lineage?.domainLabel?.() ?? 'hypercomb.io')
    const explorerSegmentsRaw = lineage?.explorerSegments?.()
    const explorerSegments = Array.isArray(explorerSegmentsRaw)
      ? explorerSegmentsRaw
        .map((x: unknown) => String(x ?? '').trim())
        .filter((x: string) => x.length > 0)
      : []
    const lineageKey = explorerSegments.length > 0
      ? `/${explorerSegments.join('/')}`
      : String(lineage?.explorerLabel?.() ?? window.location.pathname ?? '/')
    const seed = 'seed:list:v1'

    const key = `${domain}-${lineageKey}-${seed}`
    const bytes = new TextEncoder().encode(key)
    const sig = await SignatureService.sign(bytes.buffer)

    if (!sig) return

    if (sig !== this.meshSig) {
      this.meshSig = sig
      this.meshSeeds = []
      this.meshSeedsRev++
    }

    // note: ensure relays are queried for this sig (no external subscribe required)
    mesh.ensureStartedForSig(sig)

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
      if (Array.isArray(p)) {
        for (const x of p) {
          const s = String(x ?? '').trim()
          if (s) set.add(s)
        }
        continue
      }

      const seedsArr = p?.seeds
      if (Array.isArray(seedsArr)) {
        for (const x of seedsArr) {
          const s = String(x ?? '').trim()
          if (s) set.add(s)
        }
      }
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
    const host = this.host = window.ioc.get('PixiHost') as any
    if (!host?.app || !host.container) {
      this.clearMesh()
      return
    }

    const axial = window.ioc.get('AxialService') as any
    if (!axial?.items) {
      this.clearMesh()
      return
    }

    const lineage = window.ioc.get('Lineage') as any
    if (!lineage?.explorerDir || !lineage?.explorerLabel || !lineage?.changed) {
      this.clearMesh()
      return
    }

    // note: init layer + atlas (and reset shader if renderer changes)
    if (!this.layer) {
      this.layer = new Container()
      host.container.addChild(this.layer)

      this.atlas = new HexLabelAtlas(host.app.renderer, 128, 8, 8)
      this.atlasRenderer = host.app.renderer
      this.shader = null
    } else if (!this.atlas || this.atlasRenderer !== host.app.renderer) {
      this.atlas = new HexLabelAtlas(host.app.renderer, 128, 8, 8)
      this.atlasRenderer = host.app.renderer
      this.shader = null
    }

    const circumRadiusPx = 32
    const gapPx = 6
    const padPx = 10
    const textureUrl = '/spw.png'

    const locationKey = String(lineage.explorerLabel?.() ?? '/')
    const fsRev = Number(lineage.changed?.() ?? 0)
    const meshRev = this.meshSeedsRev

    const isStale = (): boolean => {
      const currentKey = String(lineage.explorerLabel?.() ?? '/')
      const currentRev = Number(lineage.changed?.() ?? 0)
      const currentMeshRev = this.meshSeedsRev
      return currentKey !== locationKey || currentRev !== fsRev || currentMeshRev !== meshRev
    }

    // note: key includes meshRev so mesh changes invalidate render baseline
    const key = `${locationKey}|${fsRev}|${meshRev}|${circumRadiusPx}|${gapPx}|${padPx}|${textureUrl}`
    this.lastKey = key

    const dir = await lineage.explorerDir()
    if (isStale()) {
      this.renderQueued = true
      return
    }
    if (!dir) {
      this.clearMesh()
      return
    }

    // note: your own seeds (filesystem)
    const localSeeds = await this.listSeedFolders(dir)
    if (isStale()) {
      this.renderQueued = true
      return
    }

    // note: union with mesh seeds (shared)
    const union = new Set<string>()
    for (const s of localSeeds) union.add(s)
    for (const s of this.meshSeeds) union.add(s)

    const seedNames = Array.from(union)
    seedNames.sort((a, b) => a.localeCompare(b))

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

    const cells = this.buildCellsFromAxial(axial, seedNames, maxCells)
    if (cells.length === 0) {
      this.clearMesh()
      return
    }

    const nextCellsKey = this.buildCellsKey(cells)

    // note: if nothing changed, avoid rebuilding geometry/shader
    if (nextCellsKey === this.renderedCellsKey && cells.length === this.renderedCount) {
      return
    }

    const hexHalfW = (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = circumRadiusPx

    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    const baseTex = await this.ensureTexture(textureUrl)
    if (isStale()) {
      this.renderQueued = true
      return
    }
    if (!baseTex || !this.atlas) {
      this.clearMesh()
      return
    }

    const labelTex = this.atlas.getAtlasTexture()

    // note: warm atlas uvs
    for (const c of cells) this.atlas.getLabelUV(c.label)

    const geom = this.buildFillQuadGeometry(cells, circumRadiusPx, gapPx, quadHalfW, quadHalfH)

    if (!this.shader) {
      this.shader = new HexSdfTextureShader(baseTex, labelTex, quadW, quadH, circumRadiusPx)
    } else {
      try {
        this.shader.setBaseTexture(baseTex)
        this.shader.setLabelAtlas(labelTex)
        this.shader.setQuadSize(quadW, quadH)
        this.shader.setRadiusPx(circumRadiusPx)
      } catch {
        this.rebuildRenderResources(host.app.renderer)
        this.renderQueued = true
        return
      }
    }

    // note: apply geometry
    if (!this.mesh) {
      this.mesh = new Mesh({ geometry: geom as any, shader: (this.shader as any).shader, texture: baseTex as any } as any)
      this.layer.addChild(this.mesh as any)
    } else {
      if (this.geom) this.geom.destroy(true)
      this.mesh.geometry = geom
      this.mesh.shader = (this.shader as any).shader
      if ('texture' in this.mesh) this.mesh.texture = baseTex
    }

    // note: keep centered
    if (this.mesh?.getLocalBounds) {
      this.mesh.position.set(0, 0)
      const b = this.mesh.getLocalBounds()
      this.mesh.position.set(-(b.x + b.width * 0.5), -(b.y + b.height * 0.5))
    }

    this.geom = geom
    this.renderedCellsKey = nextCellsKey
    this.renderedCount = cells.length
  }

  private ensureListeners = (): void => {
    if (this.listening) return
    this.listening = true

    const mark = (): void => {
      this.requestRender()
    }

    window.addEventListener('synchronize', mark)
  }

  private clearMesh = (): void => {
    if (this.mesh && this.layer) {
      try { this.layer.removeChild(this.mesh as any) } catch { /* ignore */ }
      try { this.mesh.destroy?.(true) } catch { /* ignore */ }
    }

    if (this.geom) {
      try { this.geom.destroy(true) } catch { /* ignore */ }
    }

    this.mesh = null
    this.geom = null
    this.renderedCellsKey = ''
    this.renderedCount = 0
  }

  private readonly rebuildRenderResources = (renderer: unknown): void => {
    this.clearMesh()
    this.shader = null
    this.tex = null
    this.atlas = new HexLabelAtlas(renderer, 128, 8, 8)
    this.atlasRenderer = renderer
  }

  private ensureTexture = async (url: string): Promise<Texture | null> => {
    if (this.tex) return this.tex
    this.tex = await Assets.load(url)
    return this.tex
  }

  private listSeedFolders = async (dir: FileSystemDirectoryHandle): Promise<string[]> => {
    const out: string[] = []

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'directory') continue
      if (!name) continue

      if (name === '__dependencies__') continue
      if (name === '__drones__') continue
      if (name === '__layers__') continue
      if (name === '__location__') continue
      if (name.startsWith('__') && name.endsWith('__')) continue

      out.push(name)
    }

    out.sort((a, b) => a.localeCompare(b))
    return out
  }

  private buildCellsFromAxial = (axial: any, names: string[], max: number): SeedCell[] => {
    const out: SeedCell[] = []

    for (let i = 0; i < max; i++) {
      const a = axial.items.get(i) as Axial | undefined
      const label = names[i]
      if (!a || !label) break
      out.push({ q: a.q, r: a.r, label })
    }

    return out
  }

  private buildCellsKey = (cells: SeedCell[]): string => {
    let s = ''
    for (const c of cells) s += `${c.q},${c.r}:${c.label}|`
    return s
  }

  private axialToPixel = (q: number, r: number, s: number) => ({
    x: Math.sqrt(3) * s * (q + r / 2),
    y: s * 1.5 * r
  })

  private buildFillQuadGeometry(cells: SeedCell[], r: number, gap: number, hw: number, hh: number): Geometry {
    const spacing = r + gap

    const pos = new Float32Array(cells.length * 8)
    const uv = new Float32Array(cells.length * 8)
    const labelUV = new Float32Array(cells.length * 16)
    const idx = new Uint32Array(cells.length * 6)

    let pv = 0, uvp = 0, luvp = 0, ii = 0, base = 0

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

      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], ii)
      ii += 6
      base += 4
    }

    const g = new Geometry()
      ; (g as any).addAttribute('aPosition', pos, 2)
      ; (g as any).addAttribute('aUV', uv, 2)
      ; (g as any).addAttribute('aLabelUV', labelUV, 4)
      ; (g as any).addIndex(idx)

    return g
  }
}

window.ioc.register('ShowHoneycomb', new ShowHoneycombDrone())