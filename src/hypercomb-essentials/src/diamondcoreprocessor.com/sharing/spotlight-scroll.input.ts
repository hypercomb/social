// diamondcoreprocessor.com/sharing/spotlight-scroll.input.ts
//
// Alt+wheel handler for cycling the swarm spotlight. Sister to
// mousewheel-zoom: zoom owns plain wheel, this owns alt+wheel.
// Mutually exclusive on the modifier key, no mode state needed.
//
// The handler is attached at window level (canvas has pointer-events
// none) and gates strictly on event.altKey — events without alt fall
// through to zoom. Wheel events targeted at panels marked
// `[data-consumes-wheel]` are passed through so scrolling within
// overlays keeps working.

import type { SpotlightService } from './spotlight.service.js'

const SPOTLIGHT_KEY = '@diamondcoreprocessor.com/SpotlightService'

export class SpotlightScrollInput {

  #enabled = false
  #spotlight: SpotlightService | null = null

  /** Resolves SpotlightService and starts listening. Idempotent —
   *  second call returns early. */
  public attach = (): void => {
    if (this.#enabled) return
    this.#spotlight = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(
      SPOTLIGHT_KEY,
    ) as SpotlightService | undefined ?? null
    if (!this.#spotlight) {
      // Spotlight service not yet registered — retry on next tick.
      // Module load order varies; defer and try again.
      setTimeout(this.attach, 100)
      return
    }
    window.addEventListener('wheel', this.#onWheel, { passive: false })
    this.#enabled = true
  }

  public detach = (): void => {
    if (!this.#enabled) return
    window.removeEventListener('wheel', this.#onWheel)
    this.#spotlight = null
    this.#enabled = false
  }

  #onWheel = (event: WheelEvent): void => {
    if (!event.altKey) return
    if (!this.#spotlight) return
    const target = event.target as Element | null
    if (target?.closest?.('[data-consumes-wheel]')) return

    // Direction: deltaY > 0 → cycle forward, < 0 → back.
    if (event.deltaY > 0) this.#spotlight.cycleNext()
    else if (event.deltaY < 0) this.#spotlight.cycleBack()
    else return

    event.preventDefault()
    event.stopPropagation()
  }
}

const _spotlightScroll = new SpotlightScrollInput()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SpotlightScrollInput',
  _spotlightScroll,
)

// Auto-attach on module load — no canvas / zoom plumbing needed
// because the wheel listener is window-level and self-gates on alt.
_spotlightScroll.attach()
