// src/pixi/show-honeycomb.drone.ts

import { Drone, get } from '@hypercomb/core'
import type { Container, MeshGeometry } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone.js'
import { HexSdfShader } from '../hypercomb-drones/pixi/hex-sdf.shader.js'

type Axial = { q: number; r: number }

export class ShowHoneycombDrone extends Drone {

  public host: PixiHostDrone | undefined
  public pixi: any

  public override description =
    'renders a contiguous pointy-top hex grid with sdf fill, unique borders, and a single-draw-call tiled image mesh.'

  public override grammar = [
    { example: 'show honeycomb' },
    { example: 'honeycomb' }
  ]

  public override effects = ['render'] as const

  private layer: Container | null = null

  // fill
  private fillMesh: any | null = null
  private fillShader: HexSdfShader | null = null
  private fillGeom: MeshGeometry | null = null

  // borders
  private edgeMesh: any | null = null
  private edgeGeom: MeshGeometry | null = null

  // icons
  private iconMesh: any | null = null
  private iconGeom: MeshGeometry | null = null
  private iconTexture: any | null = null
  private iconUrl: string | null = null
  private iconLoadPromise: Promise<void> | null = null
  private iconKey = ''

  private lastKey = ''
  private cells: Axial[] = []

  private cornerCache = new Map<number, Float32Array>()

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {

    const start = performance.now()

    const host = this.host = get<PixiHostDrone>(Drone.key(PixiHostDrone.name))
    if (!host?.app) return

    const pixi = this.pixi = host.pixi
    const app = host.app

    if (!this.layer) {
      this.layer = new pixi.Container()
      this.layer.sortableChildren = true
      app.stage.addChild(this.layer)
    }

    // -------------------------------------------------
    // config
    // -------------------------------------------------

    const circumRadius = 32
    const borderWidth = 1
    const fillColor = 0x1f6a85
    const borderColor = 0x0d2f3f
    const maxCells = 2500

    const iconUrl = '/spw.jpg'
    const iconScale = 2.0

    const pad = Math.max(2, Math.ceil(borderWidth * 0.75))

    const key =
      `${circumRadius}|${borderWidth}|${fillColor}|${borderColor}|${maxCells}|${pad}|${iconScale}`

    // -------------------------------------------------
    // rebuild
    // -------------------------------------------------

    if (this.lastKey !== key) {
      this.lastKey = key

      const cells = this.buildSpiral(maxCells)
      this.cells = cells

      const cellSet = new Set<string>()
      for (const c of cells) cellSet.add(`${c.q},${c.r}`)

      // ---------------- fill ----------------

      const fillGeom = this.buildFillQuadGeometry(cells, circumRadius, pad)

      if (!this.fillShader) {
        this.fillShader = new HexSdfShader(circumRadius, fillColor, borderWidth)
      } else {
        this.fillShader.setCircumRadius(circumRadius)
        this.fillShader.setBorderWidth(borderWidth)
        this.fillShader.setFillColor(fillColor)
      }

      if (!this.fillMesh) {
        this.fillMesh = new pixi.Mesh({
          geometry: fillGeom,
          shader: this.fillShader.shader
        })
        this.fillMesh.zIndex = 1
        this.layer.addChild(this.fillMesh)
      } else {
        if (this.fillGeom) this.fillGeom.destroy(true)
        this.fillMesh.geometry = fillGeom
        this.fillMesh.shader = this.fillShader.shader
      }

      this.fillGeom = fillGeom

      // ---------------- borders ----------------

      const edgeGeom =
        this.buildUniqueEdgeGeometry(cells, cellSet, circumRadius, borderWidth)

      if (!this.edgeMesh) {
        this.edgeMesh = new pixi.Mesh({
          geometry: edgeGeom,
          texture: pixi.Texture.WHITE
        })
        this.edgeMesh.tint = borderColor
        this.edgeMesh.zIndex = 0
        this.layer.addChild(this.edgeMesh)
      } else {
        if (this.edgeGeom) this.edgeGeom.destroy(true)
        this.edgeMesh.geometry = edgeGeom
        this.edgeMesh.tint = borderColor
      }

      this.edgeGeom = edgeGeom

      this.layer.sortChildren()

      // force icon rebuild
      this.iconKey = ''
    }

    // -------------------------------------------------
    // icons
    // -------------------------------------------------

    const tex = await this.ensureIconTexture(iconUrl)
    if (tex) {
      this.upsertIconMesh(tex, this.cells, circumRadius, iconScale)
    }

    const end = performance.now()
    console.log(`honeycomb heartbeat: ${(end - start).toFixed(2)} ms`)
  }

  // -------------------------------------------------
  // icon loading
  // -------------------------------------------------

  private ensureIconTexture = async (url: string): Promise<any | null> => {

    if (this.iconUrl === url && this.iconTexture) return this.iconTexture

    if (this.iconUrl !== url) {
      this.iconUrl = url
      this.iconTexture = null
      this.iconKey = ''
      this.iconLoadPromise = null
    }

    const pixi = this.pixi
    if (!pixi) return null

    if (this.iconLoadPromise) {
      try {
        await this.iconLoadPromise
        return this.iconTexture
      } catch {
        return null
      }
    }

    if (pixi?.Assets?.load) {
      this.iconLoadPromise = (async (): Promise<void> => {
        try {
          this.iconTexture = await pixi.Assets.load(url)
          this.iconKey = ''
        } finally {
          this.iconLoadPromise = null
        }
      })()

      await this.iconLoadPromise
      return this.iconTexture
    }

    this.iconTexture = pixi.Texture.from(url)
    this.iconKey = ''
    return this.iconTexture
  }

  private upsertIconMesh = (
    texture: any,
    cells: Axial[],
    circumRadius: number,
    iconScale: number
  ): void => {

    if (!this.layer || !cells.length) return

    const target = circumRadius * iconScale * 0.866
    const k = `${cells.length}|${circumRadius}|${target}`

    if (this.iconKey === k && this.iconMesh) return
    this.iconKey = k

    const geom = this.buildIconQuadGeometry(cells, target, circumRadius)

    if (!this.iconMesh) {
      this.iconMesh = new this.pixi.Mesh({ geometry: geom, texture })
      this.iconMesh.zIndex = 2
      this.layer.addChild(this.iconMesh)
    } else {
      if (this.iconGeom) this.iconGeom.destroy(true)
      this.iconMesh.geometry = geom
      this.iconMesh.texture = texture
    }

    this.iconGeom = geom
    this.layer.sortChildren()
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
      { q: 1, r: -1 }
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

  private axialToPixel = (q: number, r: number, size: number) => ({
    x: Math.sqrt(3) * size * (q + r / 2),
    y: size * 1.5 * r
  })

  // -------------------------------------------------
  // fill geometry
  // -------------------------------------------------

  private buildFillQuadGeometry = (
    cells: Axial[],
    circumRadius: number,
    pad: number
  ): MeshGeometry => {

    const halfW = (Math.sqrt(3) * circumRadius) / 2 + pad
    const halfH = circumRadius + pad

    const positions = new Float32Array(cells.length * 8)
    const uvs = new Float32Array(cells.length * 8)
    const indices = new Uint32Array(cells.length * 6)

    let pv = 0, uv = 0, ii = 0, base = 0

    for (const c of cells) {
      const { x, y } = this.axialToPixel(c.q, c.r, circumRadius)

      const x0 = x - halfW
      const x1 = x + halfW
      const y0 = y - halfH
      const y1 = y + halfH

      positions[pv++] = x0; positions[pv++] = y0
      positions[pv++] = x1; positions[pv++] = y0
      positions[pv++] = x1; positions[pv++] = y1
      positions[pv++] = x0; positions[pv++] = y1

      uvs[uv++] = -halfW; uvs[uv++] = -halfH
      uvs[uv++] =  halfW; uvs[uv++] = -halfH
      uvs[uv++] =  halfW; uvs[uv++] =  halfH
      uvs[uv++] = -halfW; uvs[uv++] =  halfH

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

  // -------------------------------------------------
  // icon geometry
  // -------------------------------------------------

  private buildIconQuadGeometry = (
    cells: Axial[],
    size: number,
    circumRadius: number
  ): MeshGeometry => {

    const half = size / 2

    const positions = new Float32Array(cells.length * 8)
    const uvs = new Float32Array(cells.length * 8)
    const indices = new Uint32Array(cells.length * 6)

    let pv = 0, uv = 0, ii = 0, base = 0

    for (const c of cells) {
      const { x, y } = this.axialToPixel(c.q, c.r, circumRadius)

      const x0 = x - half
      const x1 = x + half
      const y0 = y - half
      const y1 = y + half

      positions[pv++] = x0; positions[pv++] = y0
      positions[pv++] = x1; positions[pv++] = y0
      positions[pv++] = x1; positions[pv++] = y1
      positions[pv++] = x0; positions[pv++] = y1

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

  // -------------------------------------------------
  // borders
  // -------------------------------------------------

  private buildUniqueEdgeGeometry = (
    cells: Axial[],
    cellSet: Set<string>,
    circumRadius: number,
    borderWidth: number
  ): MeshGeometry => {

    const edgeDirs: Axial[] = [
      { q: 1, r: -1 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 }
    ]

    const corners = this.getPointyCorners(circumRadius)
    const half = borderWidth / 2

    let edgeCount = 0
    for (const c of cells) {
      const ck = `${c.q},${c.r}`
      for (let e = 0; e < 6; e++) {
        const n = edgeDirs[e]
        const nk = `${c.q + n.q},${c.r + n.r}`
        if (cellSet.has(nk) && ck > nk) continue
        edgeCount++
      }
    }

    const positions = new Float32Array(edgeCount * 8)
    const uvs = new Float32Array(edgeCount * 8)
    const indices = new Uint32Array(edgeCount * 6)

    let pv = 0, uv = 0, ii = 0, base = 0

    for (const c of cells) {
      const ck = `${c.q},${c.r}`
      const { x, y } = this.axialToPixel(c.q, c.r, circumRadius)

      for (let e = 0; e < 6; e++) {
        const n = edgeDirs[e]
        const nk = `${c.q + n.q},${c.r + n.r}`
        if (cellSet.has(nk) && ck > nk) continue

        const i0 = e
        const i1 = (e + 1) % 6

        const x0 = x + corners[i0 * 2]
        const y0 = y + corners[i0 * 2 + 1]
        const x1 = x + corners[i1 * 2]
        const y1 = y + corners[i1 * 2 + 1]

        let dx = x1 - x0
        let dy = y1 - y0
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        dx /= len
        dy /= len

        const nx = -dy * half
        const ny = dx * half

        const ax = x0 + nx
        const ay = y0 + ny
        const bx = x0 - nx
        const by = y0 - ny
        const cx2 = x1 - nx
        const cy2 = y1 - ny
        const dx2 = x1 + nx
        const dy2 = y1 + ny

        positions[pv++] = ax; positions[pv++] = ay
        positions[pv++] = bx; positions[pv++] = by
        positions[pv++] = cx2; positions[pv++] = cy2
        positions[pv++] = dx2; positions[pv++] = dy2

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
    }

    return new this.pixi.MeshGeometry({ positions, uvs, indices })
  }

  // -------------------------------------------------
  // corners
  // -------------------------------------------------

  private getPointyCorners = (circumRadius: number): Float32Array => {

    const cached = this.cornerCache.get(circumRadius)
    if (cached) return cached

    const out = new Float32Array(12)
    const start = -Math.PI / 2

    for (let i = 0; i < 6; i++) {
      const a = start + (Math.PI / 3) * i
      out[i * 2] = Math.cos(a) * circumRadius
      out[i * 2 + 1] = Math.sin(a) * circumRadius
    }

    this.cornerCache.set(circumRadius, out)
    return out
  }
}
