// diamondcoreprocessor.com/pixi/hex-overlay.shader.ts
// Minimal stub — no visual overlay drawn on tiles
import { Container } from 'pixi.js'

export class HexOverlayMesh {
  readonly mesh: Container

  constructor(_radiusPx: number, _flat: boolean) {
    this.mesh = new Container()
  }

  show(_t: number): void {}
  hide(): void {}
  update(_radiusPx: number, _flat: boolean): void {}
  setColorIndex(_index: number): void {}
  setTime(_t: number): void {}
}
