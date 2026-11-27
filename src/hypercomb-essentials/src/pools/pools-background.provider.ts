// pools/pools-background.provider.ts
//
// THE GROUND UNDER POOLS MODE. While the mode is up the whole canvas takes a
// deep green wash, the way move mode and the editor change it, so the stage
// between private and the swarm is unmistakable before a single word is read.
// The lit tiles stand out of it and the unlit ones, already dimmed by the
// renderer, sink into it.
//
// A background provider and nothing else: it follows the mode's last value
// (LIGHTS_MODE, written by the header) and asks for a redraw when it turns.
// It paints the ground only, never a cell (V2), and it registers nothing: the
// behaviour that owns pools mode hands it to the background drone
// (pools-mode.drone.ts).

import { EffectBus } from '@hypercomb/core'
import type { Graphics } from 'pixi.js'
import type { BackgroundProvider } from '../presentation/background/background.provider.js'
import { LIGHTS_MODE, type LightsMode } from './lights-contract.js'

const FILL = 0x0b2a22
const FILL_ALPHA = 0.62

export class PoolsBackgroundProvider implements BackgroundProvider {
  readonly name = 'pools'
  /** Under move (100) and the editor (90): either of those owns the ground while it is up. */
  readonly priority = 80

  #active = false
  #unsub: (() => void) | null

  constructor(requestRedraw: () => void) {
    this.#unsub = EffectBus.on<LightsMode>(LIGHTS_MODE, mode => {
      const active = mode?.active === true
      if (active === this.#active) return
      this.#active = active
      requestRedraw()
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
