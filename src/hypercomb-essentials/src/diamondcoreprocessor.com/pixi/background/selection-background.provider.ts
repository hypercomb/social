// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/background/selection-background.provider.ts

import { EffectBus } from '@hypercomb/core'
import type { Graphics } from 'pixi.js'
import type { BackgroundProvider } from './background.provider.js'

const FILL = 0x674a8c
const FILL_ALPHA = 0.4

export class SelectionBackgroundProvider implements BackgroundProvider {
  readonly name = 'selection'
  readonly priority = 50

  #active = false
  #unsub: (() => void) | null = null

  constructor(requestRedraw: () => void) {
    // Two emitters use this effect: TileSelectionDrone ({ count, keys, labels })
    // and SelectionService ({ selected: string[] }). Handle both shapes.
    this.#unsub = EffectBus.on<any>('selection:changed', (payload) => {
      const count = payload?.count ?? payload?.selected?.length ?? 0
      const next = count > 0
      if (next !== this.#active) {
        this.#active = next
        requestRedraw()
      }
    })
  }

  active(): boolean {
    return this.#active
  }

  render(g: Graphics, width: number, height: number): void {
    g.rect(-width / 2, -height / 2, width, height)
    g.fill({ color: FILL, alpha: FILL_ALPHA })
  }

  dispose(): void {
    this.#unsub?.()
    this.#unsub = null
  }
}
