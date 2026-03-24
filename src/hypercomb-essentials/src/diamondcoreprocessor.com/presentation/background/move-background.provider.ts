// diamondcoreprocessor.com/pixi/background/move-background.provider.ts
import { EffectBus } from '@hypercomb/core'
import type { Graphics } from 'pixi.js'
import type { BackgroundProvider } from './background.provider.js'

const FILL = 0x1a0508
const FILL_ALPHA = 0.85
const MODE_FILL_ALPHA = 0.4

export class MoveBackgroundProvider implements BackgroundProvider {
  readonly name = 'move'
  readonly priority = 100

  #modeActive = false
  #dragging = false
  #unsubs: (() => void)[] = []

  constructor(requestRedraw: () => void) {
    this.#unsubs.push(
      EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
        this.#modeActive = active
        requestRedraw()
      }),
      EffectBus.on('move:preview', (payload) => {
        const next = payload != null
        if (next !== this.#dragging) {
          this.#dragging = next
          requestRedraw()
        }
      }),
    )
  }

  active(): boolean {
    return this.#modeActive
  }

  render(g: Graphics, width: number, height: number): void {
    g.rect(-width / 2, -height / 2, width, height)
    g.fill({ color: FILL, alpha: this.#dragging ? FILL_ALPHA : MODE_FILL_ALPHA })
  }

  dispose(): void {
    for (const unsub of this.#unsubs) unsub()
    this.#unsubs.length = 0
  }
}
