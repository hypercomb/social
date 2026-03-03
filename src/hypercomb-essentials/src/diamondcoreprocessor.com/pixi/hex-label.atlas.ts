// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/hex-label.atlas.ts
// @essentials/default/hex-label.atlas
// @hypercomb/pixi

import { Container, RenderTexture, Text, TextStyle, Texture } from 'pixi.js'

export interface LabelUV {
  u0: number
  v0: number
  u1: number
  v1: number
}

export class HexLabelAtlas {
  private readonly atlas: RenderTexture
  private readonly map = new Map<string, LabelUV>()
  private nextIndex = 0

  private readonly cols: number
  private readonly rows: number
  private readonly style: TextStyle

  public constructor(
    private readonly renderer: any,
    private readonly cellPx = 128,
    cols = 8,
    rows = 8
  ) {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)

    this.atlas = RenderTexture.create({
      width: this.cols * this.cellPx,
      height: this.rows * this.cellPx,
      resolution: 4,
    })

    // clear once so sampling starts transparent
    // renderer.render signature is object-based in v8 :contentReference[oaicite:2]{index=2}
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true })

    this.style = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 10,
      fill: 0xffffff,
      align: 'center',
    })
  }

  public getAtlasTexture = (): Texture => {
    return this.atlas
  }

  public getLabelUV = (label: string): LabelUV => {
    const cached = this.map.get(label)
    if (cached) return cached

    // wrap if you exceed capacity (production-safe: no crash, just overwrites old slots)
    const slot = this.nextIndex % (this.cols * this.rows)
    this.nextIndex++

    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)

    const text = new Text({ text: label, style: this.style })
    text.anchor.set(0.5)
    text.position.set(
      col * this.cellPx + this.cellPx * 0.5,
      row * this.cellPx + this.cellPx * 0.5
    )

    // render into the atlas (keep previous labels)
    this.renderer.render({ container: text, target: this.atlas, clear: false })
    text.destroy()

    const u0 = (col * this.cellPx) / this.atlas.width
    const v0 = (row * this.cellPx) / this.atlas.height
    const u1 = ((col + 1) * this.cellPx) / this.atlas.width
    const v1 = ((row + 1) * this.cellPx) / this.atlas.height

    const uv: LabelUV = { u0, v0, u1, v1 }
    this.map.set(label, uv)
    return uv
  }
}

export class HexLabelAtlasFactory {
  public create = (renderer: any, cellPx = 128, cols = 8, rows = 8): HexLabelAtlas => {
    return new HexLabelAtlas(renderer, cellPx, cols, rows)
  }
}

window.ioc.register('@diamondcoreprocessor.com/HexLabelAtlasFactory', new HexLabelAtlasFactory())
