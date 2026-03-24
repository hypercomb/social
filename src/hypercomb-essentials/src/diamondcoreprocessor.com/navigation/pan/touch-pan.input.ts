// diamondcoreprocessor.com/input/pan/touch-pan.input.ts
//
// Touch-pan math delegate. Does NOT manage its own pointers — the
// TouchGestureCoordinator calls panUpdate() with previous and current
// positions when the gesture is classified as PAN.

type Point = { x: number; y: number }

export class TouchPanInput {
  #pan: {
    panBy: (delta: Point) => void
  } | null = null

  attach = (
    pan: { panBy: (delta: Point) => void },
  ): void => {
    this.#pan = pan
  }

  detach = (): void => {
    this.#pan = null
  }

  /**
   * Called by TouchGestureCoordinator on each move event during a single-finger pan.
   */
  panUpdate = (prev: Point, current: Point, sensitivity: number): void => {
    if (!this.#pan) return

    const dx = (current.x - prev.x) * sensitivity
    const dy = (current.y - prev.y) * sensitivity

    this.#pan.panBy({ x: dx, y: dy })
  }
}
