// src/app/pixi/hex-grid/hex-grid.renderer.ts

import { Container, Graphics } from 'pixi.js'
import { HexPoint } from './hex-grid.math'

export class HexGridRenderer {

  public readonly container = new Container()

  public constructor(points: HexPoint[], radius: number) {

    for (const p of points) {
      this.container.addChild(this.drawHex(p.x, p.y, radius))
    }

    // center the whole grid even though points are generated from (0,0)
    if (points.length) {
      const maxX = Math.max(...points.map(p => p.x))
      const maxY = Math.max(...points.map(p => p.y))

      const w = maxX + (radius * 2)
      const h = maxY + (Math.sqrt(3) * radius)

      this.container.pivot.set(w / 2, h / 2)
      this.container.position.set(0, 0)
    }

    this.container.alpha = 0.25
  }

  private drawHex = (x: number, y: number, r: number): Graphics => {

    const g = new Graphics()
    const verts: number[] = []

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i
      verts.push(x + r * Math.cos(angle), y + r * Math.sin(angle))
    }

    g.poly(verts)
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.35 })

    return g
  }
}
