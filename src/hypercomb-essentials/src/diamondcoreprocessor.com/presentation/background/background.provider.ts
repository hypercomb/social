// diamondcoreprocessor.com/pixi/background/background.provider.ts
import type { Graphics } from 'pixi.js'

export interface BackgroundProvider {
  readonly name: string
  readonly priority: number
  active(): boolean
  render(g: Graphics, width: number, height: number): void
  dispose?(): void
}
