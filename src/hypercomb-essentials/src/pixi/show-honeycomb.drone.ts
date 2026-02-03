import { Drone, get } from '@hypercomb/core'
import type { Container, MeshGeometry, Texture } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone.js'
import { HexSdfTextureShader } from '../hypercomb-drones/pixi/hex-sdf.shader.js'

type Axial = { q: number; r: number }

export class ShowHoneycombDrone extends Drone {
  public host: PixiHostDrone | undefined
  public pixi: any

  public override description =
    'renders a contiguous pointy-top hex grid with spacing-only separation and a single-draw-call textured mesh.'

  public override grammar = [{ example: 'show honeycomb' }, { example: 'honeycomb' }]
  public override effects = ['render'] as const

  private layer: Container | null = null

  private mesh: any | null = null
  private geom: MeshGeometry | null = null
  private shader: HexSdfTextureShader | null = null

  private tex: Texture | null = null
  private texUrl: string | null = null
  private texLoadPromise: Promise<void> | null = null

  private lastKey = ''

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    const host = (this.host = get<PixiHostDrone>(Drone.key(PixiHostDrone.name)))
    if (!host?.app) return

    const pixi = (this.pixi = host.pixi)
    const app = host.app

    if (!this.layer) {
      this.layer = new pixi.Container()
      app.stage.addChild(this.layer)
    }

    // -------------------------------------------------
    // source of truth
    // -------------------------------------------------

    const circumRadiusPx = 32

    // spacing replaces borders
    // gap increases center-to-center distance so hexes never feel crowded
    const gapPx = 6

    // quad pad gives the discard room so we don't clip at the quad edge
    const padPx = 10

    const maxCells = 2500
    const textureUrl = '/spw.png'

    const key = `${circumRadiusPx}|${gapPx}|${padPx}|${maxCells}|${textureUrl}`
    if (this.lastKey === key) return
    this.lastKey = key

    // -------------------------------------------------
    // build cells + geometry
    // -------------------------------------------------

    const cells = this.buildSpiral(maxCells)

    // regular hex bbox sizes in pixels
    const hexHalfW = (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = circumRadiusPx

    // quad is hex bbox + pad
    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    const geom = this.buildFillQuadGeometry(cells, circumRadiusPx, gapPx, quadHalfW, quadHalfH)

    // -------------------------------------------------
    // texture + shader
    // -------------------------------------------------

    const tex = await this.ensureTexture(textureUrl)
    if (!tex) return

    if (!this.shader) {
      this.shader = new HexSdfTextureShader(tex, quadW, quadH, circumRadiusPx)

      // defaults (hook these to editor state later)
      this.shader.setZoom(1.0)
      this.shader.setPan(0.0, 0.0)
    } else {
      this.shader.setTexture(tex)
      this.shader.setQuadSize(quadW, quadH)
      this.shader.setRadiusPx(circumRadiusPx)
    }

    // -------------------------------------------------
    // mesh
    // -------------------------------------------------

    if (!this.mesh) {
      this.mesh = new pixi.Mesh({ geometry: geom, shader: this.shader.shader })
      this.layer.addChild(this.mesh)
    } else {
      if (this.geom) this.geom.destroy(true)
      this.mesh.geometry = geom
      this.mesh.shader = this.shader.shader
    }

    this.geom = geom
  }

  // -------------------------------------------------
  // texture loading
  // -------------------------------------------------

  private ensureTexture = async (url: string): Promise<Texture | null> => {
    if (this.texUrl === url && this.tex) return this.tex

    if (this.texUrl !== url) {
      this.texUrl = url
      this.tex = null
      this.texLoadPromise = null
    }

    const pixi = this.pixi
    if (!pixi) return null

    if (this.texLoadPromise) {
      try {
        await this.texLoadPromise
        return this.tex
      } catch {
        return null
      }
    }

    if (pixi?.Assets?.load) {
      this.texLoadPromise = (async (): Promise<void> => {
        try {
          this.tex = await pixi.Assets.load(url)
        } finally {
          this.texLoadPromise = null
        }
      })()

      await this.texLoadPromise
      return this.tex
    }

    this.tex = pixi.Texture.from(url)
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
  // geometry (aPosition + aUV only)
  // -------------------------------------------------

  private buildFillQuadGeometry = (cells: Axial[], circumRadiusPx: number, gapPx: number, quadHalfW: number, quadHalfH: number): MeshGeometry => {
    const spacingRadiusPx = circumRadiusPx + gapPx

    const positions = new Float32Array(cells.length * 8)
    const uvs = new Float32Array(cells.length * 8)
    const indices = new Uint32Array(cells.length * 6)

    let pv = 0
    let uv = 0
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

      // aUV (standard 0..1)
      uvs[uv++] = 0; uvs[uv++] = 0
      uvs[uv++] = 1; uvs[uv++] = 0
      uvs[uv++] = 1; uvs[uv++] = 1
      uvs[uv++] = 0; uvs[uv++] = 1

      indices[ii++] = base
      indices[ii++] = base + 1
      indices[ii++] = base + 2
      indices[ii++] = base
      indices[ii++] = base + 2
      indices[ii++] = base + 3

      base += 4
    }

    return new this.pixi.MeshGeometry({ positions, uvs, indices })
  }
}
