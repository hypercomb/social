// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/show-honeycomb.drone.ts

import { Drone } from '@hypercomb/core'
import { Assets, Container, Geometry, Mesh, Texture } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone.js'
import { HexLabelAtlas } from './hex-label.atlas.js'
import { HexSdfTextureShader } from './hex-sdf.shader.js'

// note: now we carry pixel position directly
type Cell = { q: number; r: number; x: number; y: number }

export class ShowHoneycombDrone extends Drone {
  private host?: PixiHostDrone
  private layer: Container | null = null

  private mesh: any | null = null
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private tex: Texture | null = null
  private atlas: HexLabelAtlas | null = null

  private lastKey = ''

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    const { get, register, list } = window.ioc

    // host resolution
    const host = this.host = get('PixiHost')
    if (!host?.app || !host.container) return

    // axial must be ready
    const axial = get('AxialService') as any
    if (!axial?.items?.size) return

    // layer (created once)
    if (!this.layer) {
      this.layer = new Container()
      host.container.addChild(this.layer)

      this.atlas = new HexLabelAtlas(host.app.renderer, 128, 8, 8)
    }

    // parameters
    const circumRadiusPx = 32
    const gapPx = 6
    const padPx = 10

    // draw first n indices (fast lookup)
    const maxCells = 7

    const textureUrl = '/spw.png'

    const key = `${circumRadiusPx}|${gapPx}|${padPx}|${maxCells}|${textureUrl}`
    if (this.lastKey === key) return
    this.lastKey = key

    // data
    const cells = this.buildCellsFromAxial(axial, maxCells)
    if (!cells.length) return

    const hexHalfW = (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = circumRadiusPx

    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    const baseTex = await this.ensureTexture(textureUrl)
    if (!baseTex || !this.atlas) return

    // warm atlas
    for (const c of cells) this.atlas.getLabelUV(`${c.q},${c.r}`)

    const geom = this.buildFillQuadGeometry(cells, quadHalfW, quadHalfH)

    // shader
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

    // mesh
    if (!this.mesh) {
      this.mesh = new Mesh({
        geometry: geom as any,
        shader: (this.shader as any).shader,
        texture: baseTex as any,
      } as any)

      this.layer.addChild(this.mesh as any)
    } else {
      if (this.geom) this.geom.destroy(true)

      this.mesh.geometry = geom
      this.mesh.shader = (this.shader as any).shader

      if ('texture' in this.mesh) this.mesh.texture = baseTex
    }

    this.geom = geom
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private ensureTexture = async (url: string): Promise<Texture | null> => {
    if (this.tex) return this.tex
    this.tex = await Assets.load(url)
    return this.tex
  }

  private buildCellsFromAxial = (axial: any, max: number): Cell[] => {
    const out: Cell[] = []

    // important: recenter so index 0 lands at (0,0) in mesh space
    const c0 = axial.items.get(0)
    const cx = c0?.Location?.x ?? 0
    const cy = c0?.Location?.y ?? 0

    for (let i = 0; i < max; i++) {
      const a = axial.items.get(i)
      if (!a) break

      const loc = a.Location
      if (!loc) continue

      out.push({
        q: a.q,
        r: a.r,
        x: (loc.x ?? 0) - cx,
        y: (loc.y ?? 0) - cy,
      })
    }

    return out
  }

  private buildFillQuadGeometry = (cells: Cell[], hw: number, hh: number): Geometry => {
    const pos = new Float32Array(cells.length * 8)
    const uv = new Float32Array(cells.length * 8)
    const labelUV = new Float32Array(cells.length * 16)
    const idx = new Uint32Array(cells.length * 6)

    let pv = 0, uvp = 0, luvp = 0, ii = 0, base = 0

    for (const c of cells) {
      // note: positions come directly from axial service lookup
      const x0 = c.x - hw, x1 = c.x + hw
      const y0 = c.y - hh, y1 = c.y + hh

      pos.set([x0, y0, x1, y0, x1, y1, x0, y1], pv)
      pv += 8

      uv.set([0, 0, 1, 0, 1, 1, 0, 1], uvp)
      uvp += 8

      const ruv = this.atlas!.getLabelUV(`${c.q},${c.r}`)
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
