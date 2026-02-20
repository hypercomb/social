// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/show-honeycomb.drone.ts
// fix: redraw is event-driven (lineage:changed + navigate) and clears stale mesh on empty folders

import { Drone } from '@hypercomb/core'
import { Assets, Container, Geometry, Mesh, Texture } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone.js'
import { HexLabelAtlas } from './hex-label.atlas.js'
import { HexSdfTextureShader } from './hex-sdf.shader.js'

type Axial = { q: number; r: number }
type SeedCell = { q: number; r: number; label: string }

export class ShowHoneycombDrone extends Drone {
  private host?: PixiHostDrone
  private layer: Container | null = null

  private mesh: any | null = null
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private tex: Texture | null = null
  private atlas: HexLabelAtlas | null = null

  private lastKey = ''

  // event-driven redraw
  private dirty = true
  private listening = false

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    const { get, register, list } = window.ioc
    void register
    void list

    this.ensureListeners()

    const host = this.host = get('PixiHost')
    if (!host?.app || !host.container) {
      this.clearMesh()
      return
    }

    const axial = get('AxialService') as any
    if (!axial?.items) {
      this.clearMesh()
      return
    }

    const lineage = get('Lineage') as any
    if (!lineage?.explorerDir || !lineage?.explorerLabel || !lineage?.changed) {
      this.clearMesh()
      return
    }

    if (!this.layer) {
      this.layer = new Container()
      host.container.addChild(this.layer)

      this.atlas = new HexLabelAtlas(host.app.renderer, 128, 8, 8)
    }

    const circumRadiusPx = 32
    const gapPx = 6
    const padPx = 10
    const textureUrl = '/spw.png'

    const locationKey = String(lineage.explorerLabel?.() ?? '/')
    const fsRev = Number(lineage.changed?.() ?? 0)

    // gate rebuilds, but allow event-driven forcing
    const key = `${locationKey}|${fsRev}|${circumRadiusPx}|${gapPx}|${padPx}|${textureUrl}`
    if (!this.dirty && this.lastKey === key) return
    this.lastKey = key
    this.dirty = false

    const dir = await lineage.explorerDir()
    if (!dir) {
      this.clearMesh()
      return
    }

    const seedNames = await this.listSeedFolders(dir)
    if (seedNames.length === 0) {
      // critical: remove stale geometry when folder is empty
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

    const hexHalfW = (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = circumRadiusPx

    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    const baseTex = await this.ensureTexture(textureUrl)
    if (!baseTex || !this.atlas) {
      this.clearMesh()
      return
    }

    for (const c of cells) this.atlas.getLabelUV(c.label)

    const geom = this.buildFillQuadGeometry(cells, circumRadiusPx, gapPx, quadHalfW, quadHalfH)

    if (!this.shader) {
      this.shader = new HexSdfTextureShader(
        baseTex,
        this.atlas.getAtlasTexture(),
        quadW,
        quadH,
        circumRadiusPx
      )
    } else {
      this.shader.setBaseTexture(baseTex)
      this.shader.setLabelAtlas(this.atlas.getAtlasTexture())
      this.shader.setQuadSize(quadW, quadH)
      this.shader.setRadiusPx(circumRadiusPx)
    }

    if (!this.mesh) {
      this.mesh = new Mesh({
        geometry: geom as any,
        shader: (this.shader as any).shader,
        texture: baseTex as any
      } as any)

      this.layer.addChild(this.mesh as any)
    } else {
      if (this.geom) this.geom.destroy(true)

      this.mesh.geometry = geom
      this.mesh.shader = (this.shader as any).shader
      if ('texture' in this.mesh) this.mesh.texture = baseTex
    }

    if (this.mesh?.getLocalBounds) {
      this.mesh.position.set(0, 0)
      const b = this.mesh.getLocalBounds()
      this.mesh.position.set(-(b.x + b.width * 0.5), -(b.y + b.height * 0.5))
    }

    this.geom = geom
  }

  // -------------------------------------------------
  // listeners
  // -------------------------------------------------

  private ensureListeners = (): void => {
    if (this.listening) return
    this.listening = true

    const mark = (): void => { this.dirty = true }

    // explorer clicks (lineage.explorerEnter/up) trigger this immediately now
    window.addEventListener('lineage:changed', mark)

    // url/nav changes (search bar, movement, back/forward) still count too
    window.addEventListener('navigate', mark)
    window.addEventListener('popstate', mark)
  }

  // -------------------------------------------------
  // cleanup
  // -------------------------------------------------

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
    this.dirty = true
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

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

  private axialToPixel = (q: number, r: number, s: number) => ({
    x: Math.sqrt(3) * s * (q + r / 2),
    y: s * 1.5 * r
  })

  private buildFillQuadGeometry(
    cells: SeedCell[],
    r: number,
    gap: number,
    hw: number,
    hh: number
  ): Geometry {
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
    ;(g as any).addAttribute('aPosition', pos, 2)
    ;(g as any).addAttribute('aUV', uv, 2)
    ;(g as any).addAttribute('aLabelUV', labelUV, 4)
    ;(g as any).addIndex(idx)

    return g
  }
}

window.ioc.register('ShowHoneycomb', new ShowHoneycombDrone())