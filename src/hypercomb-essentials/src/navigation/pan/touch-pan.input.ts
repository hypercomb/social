// input/pan/touch-pan.input.ts
//
// Touch-pan math delegate. Does NOT manage its own pointers — the
// TouchGestureCoordinator calls panUpdate() with previous and current
// positions when the gesture is classified as PAN.

type Point = { x: number; y: number }

export class TouchPanInput {
  #pan: {
    panBy: (delta: Point) => Point
  } | null = null

  attach = (
    pan: { panBy: (delta: Point) => Point },
  ): void => {
    this.#pan = pan
  }

  detach = (): void => {
    this.#pan = null
  }

  /**
   * Called by TouchGestureCoordinator on each move event during a single-finger pan.
   * Returns the travel the viewport actually applied — zero at a stop.
   */
  panUpdate = (prev: Point, current: Point, sensitivity: number): Point => {
    if (!this.#pan) return { x: 0, y: 0 }

    const dx = (current.x - prev.x) * sensitivity
    const dy = (current.y - prev.y) * sensitivity

    return this.#pan.panBy({ x: dx, y: dy })
  }
}
