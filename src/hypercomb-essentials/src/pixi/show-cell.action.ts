// src/hypercomb-actions/pixi/show-cell.action.ts

import { Action } from '@hypercomb/core'

type PixiLib = {
  Application: new () => any
  Container: new () => any
  Mesh: new (options: { geometry: any; texture?: any }) => any
  MeshGeometry: new (options: {
    attributes: {
      aPosition: { buffer: Float32Array; size: number }
      aUV: { buffer: Float32Array; size: number }
    }
    indices: Uint16Array
  }) => any
  Text: new (options: any) => any
  Texture: { WHITE: any }
}

export class ShowCellAction extends Action {

  public description =
    'Renders a single hex cell using mesh geometry (no masks) with centered text.'

  public grammar = [
    { example: 'show cell' },
    { example: 'cell' }
  ]

  public effects = ['render'] as const

  protected override run = async (grammar:string): Promise<void> => {
    const pixi = (window as any).__hypercomb_libs__?.pixi as PixiLib | undefined
    const hostState = (window as any).__hypercomb_pixi__ as { app: any } | undefined

    if (!pixi || !hostState?.app) {
      console.log('[pixi] missing host; run "add pixi" first')
      return
    }

    const app = hostState.app

    // -------------------------------------------------
    // shared render layer
    // -------------------------------------------------
    const layerKey = '__hypercomb_cells__'
    let layer = (window as any)[layerKey]
    if (!layer) {
      layer = new pixi.Container()
      ;(window as any)[layerKey] = layer
      app.stage.addChild(layer)
    }

    layer.removeChildren()

    // -------------------------------------------------
    // sizing
    // -------------------------------------------------
    const w = app.renderer.width
    const h = app.renderer.height
    const r = Math.max(64, Math.floor(Math.min(w, h) * 0.18))

    // -------------------------------------------------
    // texture (cheap + cached)
    // -------------------------------------------------
    const texture = this.getSharedTexture(pixi)

    // -------------------------------------------------
    // mesh (geometry clips image)
    // -------------------------------------------------
    const geometry = this.getSharedHexGeometry(r, w, h, pixi)
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

    layer.addChild(mesh)
    layer.addChild(label)

    console.log('[pixi] show cell rendered (v8 mesh, no masks)')
  }

  // -------------------------------------------------
  // geometry (cached, reusable, GPU-fast)
  // -------------------------------------------------
  private getSharedHexGeometry = (
    r: number,
    w: number,
    h: number,
    pixi: PixiLib
  ): any => {
    const key = `__hypercomb_hex_geom__:${r}`
    const cached = (window as any)[key]
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

    const geom = new pixi.MeshGeometry({
      attributes: {
        aPosition: {
          buffer: new Float32Array(positions),
          size: 2
        },
        aUV: {
          buffer: new Float32Array(uvs),
          size: 2
        }
      },
      indices: new Uint16Array(indices)
    })

    ;(window as any)[key] = geom
    return geom
  }

  // -------------------------------------------------
  // texture (white base, zero network)
  // -------------------------------------------------
  private getSharedTexture = (pixi: PixiLib): any => {
    const key = '__hypercomb_cell_texture__'
    const cached = (window as any)[key]
    if (cached) return cached

    const t = pixi.Texture.WHITE
    ;(window as any)[key] = t
    return t
  }
}
