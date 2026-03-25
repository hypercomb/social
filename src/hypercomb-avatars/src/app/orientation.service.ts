// Tracks device orientation and exposes the counter-rotation angle
// needed to keep content upright relative to the viewer.

export class OrientationService extends EventTarget {
  #angle = 0

  constructor() {
    super()
    const so = screen.orientation
    if (!so) return
    this.#angle = -(so.angle)
    so.addEventListener('change', () => {
      this.#angle = -(so.angle)
      this.dispatchEvent(new Event('change'))
    })
  }

  get angle(): number { return this.#angle }
}
