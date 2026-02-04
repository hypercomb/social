// src/pixi/show-honeycomb.drone.ts
import { Drone, get, list } from '@hypercomb/core'
import type { Container, MeshGeometry, Texture } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone.js'
import { HexLabelAtlas } from './hex-label.atlas.js';
import { HexSdfTextureShader } from './hex-sdf.shader.js';

type Axial = { q: number; r: number }

export class ShowHoneycombDrone extends Drone {
  private hostkey = 'ddd2317a1089b8b067a2d1f1e48c0ddcc3f8a9fe49333e1a8a868c9f69e39a31'
  public host: PixiHostDrone | undefined
  public pixi: any

  private layer: Container | null = null

  private mesh: any | null = null
  private geom: MeshGeometry | null = null
  private shader: HexSdfTextureShader | null = null

  private tex: Texture | null = null
  private atlas: HexLabelAtlas | null = null

  private lastKey = ''

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    
    const host = (this.host = get<PixiHostDrone>(this.hostkey))
    if (!host?.app) return
    const start = performance.now()

    const pixi = (this.pixi = host.pixi)
    const app = host.app

    if (!this.layer) {
      this.layer = new pixi.Container()
      app.stage.addChild(this.layer)

      // renderer is available now
      this.atlas = new HexLabelAtlas(app.renderer, 128, 8, 8)
    }

    const circumRadiusPx = 32
    const gapPx = 6.5
    const padPx = 10
    const maxCells = 1000
    const textureUrl = '/spw.png'

    const key = `${circumRadiusPx}|${gapPx}|${padPx}|${maxCells}|${textureUrl}`
    if (this.lastKey === key) return
    this.lastKey = key

    const cells = this.buildSpiral(maxCells)

    const hexHalfW = (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = circumRadiusPx

    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    const baseTex = await this.ensureTexture(textureUrl)
    if (!baseTex || !this.atlas) return

    // make sure atlas has UVs for all visible labels before we build geometry
    // (this is cheap and avoids “first frame blank labels”)
    for (const c of cells) this.atlas.getLabelUV(this.axialLabel(c.q, c.r))

    const geom = this.buildFillQuadGeometry(cells, circumRadiusPx, gapPx, quadHalfW, quadHalfH)

    if (!this.shader) {
      this.shader = new HexSdfTextureShader(baseTex, this.atlas.getAtlasTexture(), quadW, quadH, circumRadiusPx)
    } else {
      this.shader.setBaseTexture(baseTex)
      this.shader.setLabelAtlas(this.atlas.getAtlasTexture())
      this.shader.setQuadSize(quadW, quadH)
      this.shader.setRadiusPx(circumRadiusPx)
    }

    if (!this.mesh) {
      this.mesh = new pixi.Mesh({ geometry: geom, shader: this.shader.shader })
      this.layer.addChild(this.mesh)
    } else {
      if (this.geom) this.geom.destroy(true)
      this.mesh.geometry = geom
      this.mesh.shader = this.shader.shader
    }

    this.geom = geom

    const end = performance.now()
    console.log(`ShowHoneycombDrone: updated mesh with ${cells.length} cells in ${(end - start).toFixed(1)} ms`)
  }

  // -------------------------------------------------
  // texture loading
  // -------------------------------------------------

  private ensureTexture = async (url: string): Promise<Texture | null> => {
    if (this.tex) return this.tex
    this.tex = await this.pixi.Assets.load(url)
    return this.tex
  }

  // -------------------------------------------------
  // spiral
  // -------------------------------------------------

  private buildSpiral = (maxCells: number): Axial[] => {
    const cells: Axial[] = [{ q: 0, r: 0 }]
    if (maxCells <= 1) return cells

    const dirs: Axial[] = [
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
    ]

    for (let ring = 1; cells.length < maxCells; ring++) {
      let q = dirs[4].q * ring
      let r = dirs[4].r * ring

      for (let side = 0; side < 6; side++) {
        const d = dirs[side]
        for (let step = 0; step < ring; step++) {
          if (cells.length >= maxCells) break
          cells.push({ q, r })
          q += d.q
          r += d.r
        }
      }
    }

    return cells
  }

  // -------------------------------------------------
  // axial -> pixel
  // -------------------------------------------------

  private axialToPixel = (q: number, r: number, spacingRadiusPx: number) => ({
    x: Math.sqrt(3) * spacingRadiusPx * (q + r / 2),
    y: spacingRadiusPx * 1.5 * r,
  })

  // -------------------------------------------------
  // coord labels (stable, readable, no fragile ASCII shifts)
  // -------------------------------------------------

  private axialLabel = (q: number, r: number): string => {
    // display-friendly and unambiguous
    return `${q},${r}`
  }

  // -------------------------------------------------
  // geometry (explicit attributes — pixi v8 safe)
  // -------------------------------------------------

  private buildFillQuadGeometry = (
    cells: Axial[],
    circumRadiusPx: number,
    gapPx: number,
    quadHalfW: number,
    quadHalfH: number
  ): MeshGeometry => {
    const spacingRadiusPx = circumRadiusPx + gapPx

    const positions = new Float32Array(cells.length * 8)
    const uvs = new Float32Array(cells.length * 8)
    const labelUVs = new Float32Array(cells.length * 16)

    // 100 cells => 400 verts => 600 indices (fits u16)
    const indices = new Uint16Array(cells.length * 6)

    let pv = 0
    let uv = 0
    let luv = 0
    let ii = 0
    let base = 0

    for (const c of cells) {
      const { x, y } = this.axialToPixel(c.q, c.r, spacingRadiusPx)

      const x0 = x - quadHalfW
      const x1 = x + quadHalfW
      const y0 = y - quadHalfH
      const y1 = y + quadHalfH

      // aPosition
      positions[pv++] = x0; positions[pv++] = y0
      positions[pv++] = x1; positions[pv++] = y0
      positions[pv++] = x1; positions[pv++] = y1
      positions[pv++] = x0; positions[pv++] = y1

      // aUV
      uvs[uv++] = 0; uvs[uv++] = 0
      uvs[uv++] = 1; uvs[uv++] = 0
      uvs[uv++] = 1; uvs[uv++] = 1
      uvs[uv++] = 0; uvs[uv++] = 1

      // aLabelUV (same vec4 on all 4 verts of the quad)
      const rect = this.atlas!.getLabelUV(this.axialLabel(c.q, c.r))
      for (let v = 0; v < 4; v++) {
        labelUVs[luv++] = rect.u0
        labelUVs[luv++] = rect.v0
        labelUVs[luv++] = rect.u1
        labelUVs[luv++] = rect.v1
      }

      // indices
      indices[ii++] = base
      indices[ii++] = base + 1
      indices[ii++] = base + 2
      indices[ii++] = base
      indices[ii++] = base + 2
      indices[ii++] = base + 3
      base += 4
    }

    // critical: in pixi v8, custom attributes must be explicitly registered on the geometry
    const g = new this.pixi.MeshGeometry()
    g.addAttribute('aPosition', positions, 2)
    g.addAttribute('aUV', uvs, 2)
    g.addAttribute('aLabelUV', labelUVs, 4)
    g.addIndex(indices)

    return g
  }
}
