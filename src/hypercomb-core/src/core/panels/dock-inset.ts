// hypercomb-core/src/core/panels/dock-inset.ts
//
// THE RESERVATION — a docked window tells the canvas how much of one edge it
// covers, so tiles are laid out in the space that is left instead of under
// the window. One owner per window; `size: 0` hands the edge back.
//
// This is the tool window's base layer, so it lives here, framework-free.
// The Angular `hcDockInset` directive is an adapter over it, and every
// framework-free docked window gets it from `DockedPanel` (`reserveInset`):
// before this it was written three times (the directive, the layout-targets
// window, the tile editor), and a fourth window that docked without copying
// it (the host directory) covered the tiles it sat beside.
//
// Two rules, kept from the directive: a timer races the frame, so a window
// opened in a document that is not rendering still reserves; and a box that
// spans the viewport along the docked axis (a phone sheet) reserves nothing,
// or the canvas would be squeezed to zero behind it.

import { EffectBus } from '../../effect-bus.js'

export type DockSide = 'left' | 'right' | 'top' | 'bottom'

export interface InsetRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** How much of `side` a box covers, in CSS pixels; 0 for an empty box and for
 *  one that spans the viewport across that axis. */
export function reservationFor(
  side: DockSide,
  rect: InsetRect,
  viewport: { readonly width: number; readonly height: number },
): number {
  if (rect.width <= 0 || rect.height <= 0) return 0

  const spansX = rect.left <= 1 && rect.right >= viewport.width - 1
  const spansY = rect.top <= 1 && rect.bottom >= viewport.height - 1
  const horizontal = side === 'left' || side === 'right'
  if (horizontal ? spansX : spansY) return 0

  switch (side) {
    case 'left':   return Math.max(0, rect.right)
    case 'right':  return Math.max(0, viewport.width - rect.left)
    case 'top':    return Math.max(0, rect.bottom)
    case 'bottom': return Math.max(0, viewport.height - rect.top)
  }
}

const FRAMELESS_RETRY_MS = 60
let counter = 0

/** Keeps one element's reservation current until `stop()`. */
export class DockInset {
  readonly #el: HTMLElement
  readonly #owner: string
  #side: DockSide
  #active = true
  #observer: ResizeObserver | null = null
  #offPoll: (() => void) | null = null
  #frame = 0
  #timer: ReturnType<typeof setTimeout> | 0 = 0
  #running = false

  constructor(el: HTMLElement, side: DockSide = 'right', owner = `dock-${++counter}`) {
    this.#el = el
    this.#side = side
    this.#owner = owner
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(this.#schedule)
      this.#observer.observe(this.#el)
    }
    window.addEventListener('resize', this.#schedule)
    this.#offPoll = EffectBus.on('viewport:inset-poll', this.#schedule)
    this.#schedule()
  }

  set side(side: DockSide) {
    if (side === this.#side) return
    this.#clear()
    this.#side = side || 'right'
    this.#schedule()
  }

  set active(active: boolean) {
    this.#active = active !== false
    this.#schedule()
  }

  stop(): void {
    if (!this.#running) return
    this.#running = false
    this.#observer?.disconnect()
    this.#observer = null
    window.removeEventListener('resize', this.#schedule)
    this.#offPoll?.()
    this.#offPoll = null
    if (this.#frame) cancelAnimationFrame(this.#frame)
    if (this.#timer) clearTimeout(this.#timer)
    this.#frame = 0
    this.#timer = 0
    this.#clear()
  }

  readonly #schedule = (): void => {
    if (!this.#running || this.#frame || this.#timer) return
    this.#frame = requestAnimationFrame(this.#measure)
    this.#timer = setTimeout(this.#measure, FRAMELESS_RETRY_MS)
  }

  readonly #measure = (): void => {
    if (this.#frame) { cancelAnimationFrame(this.#frame); this.#frame = 0 }
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = 0 }
    if (!this.#running) return
    const size = this.#active
      ? reservationFor(this.#side, this.#el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
      : 0
    if (size <= 0) { this.#clear(); return }
    EffectBus.emit('viewport:inset', { owner: this.#owner, side: this.#side, size })
  }

  #clear(): void {
    EffectBus.emit('viewport:inset', { owner: this.#owner, side: this.#side, size: 0 })
  }
}
