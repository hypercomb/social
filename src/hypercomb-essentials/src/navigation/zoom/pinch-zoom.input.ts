// input/zoom/pinch-zoom.input.ts
//
// Pinch-zoom math delegate. Does NOT manage its own pointers — the
// TouchGestureCoordinator calls pinchUpdate() with two touch points
// when the gesture is classified as PINCH.

import { EffectBus } from '@hypercomb/core'
import { getLaneScrollAxis } from '../../sequence/lane-viewport-mode.js'
import { viewportIsFramed } from '../../sequence/frame-lock.js'

type Point = { x: number; y: number }

// In lane mode free zoom is off — the legibility ladder owns scale, so a
// pinch STEPS it instead. The cumulative ratio since the last step must
// cross this much before a rung changes: each rung re-arranges tiles and
// commits, so a jittery finger must never mint a run of layers.
const LADDER_RATIO = 1.35

export class PinchZoomInput {
  #ladderRatio = 1
  #zoom: {
    zoomByFactor: (factor: number, pivot: Point) => void
    zoomToFit?: () => void
  } | null = null

  #minScale = 0.2

  attach = (
    zoom: {
      zoomByFactor: (factor: number, pivot: Point) => void
      zoomToFit?: () => void
    },
    minScale?: number,
  ): void => {
    this.#zoom = zoom
    if (minScale != null) this.#minScale = minScale
  }

  detach = (): void => {
    this.#zoom = null
  }

  /**
   * Called by TouchGestureCoordinator on each move event during a pinch.
   * Returns the new distance so the coordinator can track it.
   */
  pinchUpdate = (
    p1: Point,
    p2: Point,
    lastDistance: number,
    sensitivity: number,
  ): { distance: number } => {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (dist <= 0 || lastDistance <= 0) return { distance: dist || lastDistance }

    let factor = dist / lastDistance
    if (!Number.isFinite(factor) || factor <= 0) return { distance: lastDistance }

    // clamp per-move factor to avoid spikes on noisy touch hardware
    factor = Math.max(0.5, Math.min(2.0, factor))

    // apply sensitivity multiplier
    // sensitivity > 1 = more responsive, < 1 = less responsive
    // We scale the deviation from 1.0 by the sensitivity
    const deviation = factor - 1.0
    factor = 1.0 + deviation * sensitivity

    // A framed page owns its scale — pinching cannot change it, and there is
    // no ladder to step here either: the frame is one fixed shape. Hand the
    // live distance back so the gesture keeps tracking; it simply does nothing.
    if (viewportIsFramed()) return { distance: dist }

    if (getLaneScrollAxis()) {
      // Spread = read (fewer, wider lanes); squeeze = scan (more lanes).
      this.#ladderRatio *= factor
      if (this.#ladderRatio >= LADDER_RATIO) {
        this.#ladderRatio = 1
        EffectBus.emit('lanes:step', { dir: -1 })
      } else if (this.#ladderRatio <= 1 / LADDER_RATIO) {
        this.#ladderRatio = 1
        EffectBus.emit('lanes:step', { dir: +1 })
      }
      return { distance: dist }
    }
    this.#ladderRatio = 1

    const pivot = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

    this.#zoom?.zoomByFactor(factor, pivot)

    return { distance: dist }
  }
}

window.ioc.register('@diamondcoreprocessor.com/PinchZoomInput', new PinchZoomInput())
