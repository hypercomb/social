// src/hypercomb-drones/pixi/show-cell.drone.ts

import { Drone, get, has } from '@hypercomb/core'
import type { Container, Mesh, MeshGeometry, Text, Texture } from 'pixi.js'
import { PixiHostDrone } from './pixi-host.drone'

export class ShowCellDrone extends Drone {

  public host: PixiHostDrone | undefined
  public pixi: any

  public description =
    'Renders a single hex cell using mesh geometry (no masks) with centered text.'

  public grammar = [
    { example: 'show cell' },
    { example: 'cell' }
  ]

  public effects = ['render'] as const

  // -------------------------------------------------
  // cached objects (live on the registered instance)
  // -------------------------------------------------
  private layer: Container | null = null
  private texture: Texture | null = null

  // note: geometry is keyed by radius so it can be reused safely
  private geometryByRadius = new Map<number, MeshGeometry>()

  protected override sense = (grammar: string): boolean | Promise<boolean> => {
    // somehow check to see if the lineage is correct
    return true
  }

  protected override heartbeat = async (grammar: string): Promise<void> => {

    const host = this.host = get<PixiHostDrone>(PixiHostDrone.name)
    const pixi = this.pixi = this.host!.pixi

    if (!this.host?.app) {
      console.log('[pixi] missing host; run "add pixi" first')
      return
    }

    const app = host!.app!

    // -------------------------------------------------
    // shared render layer (cached on this instance)
    // -------------------------------------------------
    // note:
    // - this.layer survives across heartbeats because the drone instance is registered
    // - we attach it to the host stage once
    if (!this.layer) {
      this.layer = new pixi.Container()
      app.stage.addChild(this.layer)
    }

    this.layer.removeChildren()

    // -------------------------------------------------
    // sizing
    // -------------------------------------------------
    const w = app.renderer.width
    const h = app.renderer.height
    const r = Math.max(64, Math.floor(Math.min(w, h) * 0.18))

    // -------------------------------------------------
    // texture (cached on this instance)
    // -------------------------------------------------
    const texture = this.getSharedTexture()

    // -------------------------------------------------
    // geometry (cached by radius on this instance)
    // -------------------------------------------------
    const geometry = this.getSharedHexGeometry(r, w, h)

    // -------------------------------------------------
    // mesh
    // -------------------------------------------------
    const mesh = new pixi.Mesh({ geometry, texture })

    // -------------------------------------------------
    // centered label
    // -------------------------------------------------
    const label = new pixi.Text({
      text: 'cell',
      style: {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
        fontSize: Math.floor(r * 0.28),
        fontWeight: '800',
        fill: 0xffffff
      }
    })

    label.anchor.set(0.5)
    label.position.set(w * 0.5, h * 0.5)

    this.layer.addChild(mesh)
    this.layer.addChild(label)

    console.log('[pixi] show cell rendered (v8 mesh, no masks)')
  }

  private getSharedHexGeometry = (
    r: number,
    w: number,
    h: number
  ): MeshGeometry => {

    const cached = this.geometryByRadius.get(r)
    if (cached) return cached

    const cx = w * 0.5
    const cy = h * 0.5

    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    // center vertex
    positions.push(cx, cy)
    uvs.push(0.5, 0.5)

    // 6 corners
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r

      positions.push(x, y)
      uvs.push(Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5)
    }

    // triangle fan
    for (let i = 1; i <= 6; i++) {
      indices.push(0, i, i === 6 ? 1 : i + 1)
    }

    const pixi = this.pixi

    const geom = new pixi.MeshGeometry({
      positions: new Float32Array(positions),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices)
    })

    this.geometryByRadius.set(r, geom)
    return geom
  }

  // -------------------------------------------------
  // texture (white base, zero network)
  // -------------------------------------------------
  private getSharedTexture = (): Texture => {
    if (this.texture) return this.texture
    const pixi = this.pixi
    this.texture = pixi.Texture.WHITE
    return this.texture!
  }

}
