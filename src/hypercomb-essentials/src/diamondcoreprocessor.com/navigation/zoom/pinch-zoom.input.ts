// diamondcoreprocessor.com/input/zoom/pinch-zoom.input.ts
//
// Pinch-zoom math delegate. Does NOT manage its own pointers — the
// TouchGestureCoordinator calls pinchUpdate() with two touch points
// when the gesture is classified as PINCH.

type Point = { x: number; y: number }

export class PinchZoomInput {
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

    const pivot = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

    this.#zoom?.zoomByFactor(factor, pivot)

    return { distance: dist }
  }
}

window.ioc.register('@diamondcoreprocessor.com/PinchZoomInput', new PinchZoomInput())
