// src/pixi/show-honeycomb.drone.ts

import { Drone } from '@hypercomb/core'
import { Assets, Container, Geometry, Mesh, Texture } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone.js'
import { HexLabelAtlas } from './hex-label.atlas.js'
import { HexSdfTextureShader } from './hex-sdf.shader.js'

type Axial = { q: number; r: number }

export class ShowHoneycombDrone extends Drone {

  private host?: PixiHostDrone
  private layer: Container | null = null

  // note: pixi typings vary by build; keep these runtime-safe and avoid generic constraints
  private mesh: any | null = null
  private geom: Geometry | null = null
  private shader: HexSdfTextureShader | null = null

  private tex: Texture | null = null
  private atlas: HexLabelAtlas | null = null

  private lastKey = ''

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    const { get } = (window as any).ioc

    // host resolution
    const host = this.host = get('Pixi Host')
    if (!host?.app || !host.container) return

    // layer (created once)
    if (!this.layer) {
      this.layer = new Container()
      host.container.addChild(this.layer)

      this.atlas = new HexLabelAtlas(
        host.app.renderer,
        128,
        8,
        8
      )
    }

    // parameters
    const circumRadiusPx = 32
    const gapPx = 6.5
    const padPx = 10
    const maxCells = 1000
    const textureUrl = '/spw.png'

    const key = `${circumRadiusPx}|${gapPx}|${padPx}|${maxCells}|${textureUrl}`
    if (this.lastKey === key) return
    this.lastKey = key

    // data
    const cells = this.buildSpiral(maxCells)

    const hexHalfW = (Math.sqrt(3) * circumRadiusPx) / 2
    const hexHalfH = circumRadiusPx

    const quadHalfW = hexHalfW + padPx
    const quadHalfH = hexHalfH + padPx
    const quadW = quadHalfW * 2
    const quadH = quadHalfH * 2

    const baseTex = await this.ensureTexture(textureUrl)
    if (!baseTex || !this.atlas) return

    // warm atlas
    for (const c of cells) {
      this.atlas.getLabelUV(`${c.q},${c.r}`)
    }

    const geom = this.buildFillQuadGeometry(
      cells,
      circumRadiusPx,
      gapPx,
      quadHalfW,
      quadHalfH
    )

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
      // some pixi builds type mesh shader as textureshader and require a texture field
      // we provide texture and keep shader assignment runtime-correct
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

      // keep texture in sync for mesh types that require it
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

  private buildSpiral = (max: number): Axial[] => {
    const out: Axial[] = [{ q: 0, r: 0 }]
    if (max <= 1) return out

    const dirs: Axial[] = [
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
    ]

    for (let ring = 1; out.length < max; ring++) {
      let q = dirs[4].q * ring
      let r = dirs[4].r * ring

      for (let side = 0; side < 6; side++) {
        const d = dirs[side]
        for (let step = 0; step < ring; step++) {
          if (out.length >= max) break
          out.push({ q, r })
          q += d.q
          r += d.r
        }
      }
    }

    return out
  }

  private axialToPixel = (q: number, r: number, s: number) => ({
    x: Math.sqrt(3) * s * (q + r / 2),
    y: s * 1.5 * r,
  })

  private buildFillQuadGeometry(
    cells: Axial[],
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

      const ruv = this.atlas!.getLabelUV(`${c.q},${c.r}`)
      for (let i = 0; i < 4; i++) {
        labelUV.set([ruv.u0, ruv.v0, ruv.u1, ruv.v1], luvp)
        luvp += 4
      }

      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], ii)
      ii += 6
      base += 4
    }

    // pixi v8 geometry descriptor typing differs by build; construct explicitly
    // attribute names must match the shader: aPosition, aUV, aLabelUV
    const g = new Geometry()

    ;(g as any).addAttribute('aPosition', pos, 2)
    ;(g as any).addAttribute('aUV', uv, 2)
    ;(g as any).addAttribute('aLabelUV', labelUV, 4)
    ;(g as any).addIndex(idx)

    return g
  }
}
