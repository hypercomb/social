// diamondcoreprocessor.com/navigation/input-gate.service.ts
//
// InputGate — shared input exclusivity. One source at a time. Context
// menu auto-suppressed while claimed.
//
// Defined here (not inside zoom.drone.ts) so consumers can re-export
// without dragging the entire ZoomDrone module — including its
// auto-registration side-effects — into namespace dependency bundles.
// The previous layout caused esbuild to inline the whole zoom.drone.ts
// (and a stale snapshot of ZoomDrone with its `register(...)` call) into
// the @diamondcoreprocessor.com/navigation namespace dep, and the
// build cache only tracks direct members so changes to zoom.drone.ts
// were invisible to the namespace dep's input signature.

export class InputGate extends EventTarget {
  #owner: string | null = null
  #locked = false

  get active(): boolean { return this.#locked || this.#owner !== null }
  get locked(): boolean { return this.#locked }
  get owner(): string | null { return this.#owner }

  lock = (): void => {
    if (this.#locked) return
    this.#locked = true
    this.dispatchEvent(new CustomEvent('change'))
  }
  unlock = (): void => {
    if (!this.#locked) return
    this.#locked = false
    this.dispatchEvent(new CustomEvent('change'))
  }

  claim = (source: string): boolean => {
    if (this.#locked) return false
    if (this.#owner && this.#owner !== source) return false
    if (this.#owner === source) return true
    this.#owner = source
    this.dispatchEvent(new CustomEvent('change'))
    return true
  }

  release = (source: string): void => {
    if (this.#owner !== source) return
    this.#owner = null
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Emergency reset — drops all locks and ownership.
   *  Wired to the Escape cascade as a last-resort recovery so a leaked
   *  claim or unmatched lock can never permanently block input. */
  clear = (): void => {
    if (!this.#locked && this.#owner === null) return
    this.#locked = false
    this.#owner = null
    this.dispatchEvent(new CustomEvent('change'))
  }

  constructor() {
    super()
    document.addEventListener('contextmenu', (e) => {
      if (this.#owner || e.ctrlKey || e.metaKey) e.preventDefault()
    }, true)
  }
}

const _inputGate = new InputGate()
window.ioc.register('@diamondcoreprocessor.com/InputGate', _inputGate)
