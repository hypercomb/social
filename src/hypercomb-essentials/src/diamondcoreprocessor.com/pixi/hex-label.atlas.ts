// src/hypercomb-drones/pixi/hex-label-atlas.ts
import { RenderTexture, Text, TextStyle, Texture } from 'pixi.js'

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
      resolution: 1,
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

    const style = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 32,
      fill: 0xffffff,
      align: 'center',
    })

    const text = new Text({ text: label, style })
    text.anchor.set(0.5)
    text.position.set(
      col * this.cellPx + this.cellPx / 2,
      row * this.cellPx + this.cellPx / 2
    )

    // pixi v8 render signature: one object argument
    // clear=false so we keep previously rendered labels in the atlas
    // this.renderer.render({
    //   container: text,
    //   target: this.atlas,
    //   clear: false,
    // })

    const u0 = (col * this.cellPx) / this.atlas.width
    const v0 = (row * this.cellPx) / this.atlas.height
    const u1 = ((col + 1) * this.cellPx) / this.atlas.width
    const v1 = ((row + 1) * this.cellPx) / this.atlas.height

    const uv: LabelUV = { u0, v0, u1, v1 }
    this.map.set(label, uv)
    return uv
  }
}
