// dock-inset.directive.ts — the common toolwindow inset producer.
//
// Drop `[hcDockInset]="'right'"` on a docked panel's root element and it
// broadcasts how much screen edge that panel reserves via the `viewport:inset`
// EffectBus contract. The zoom drone (essentials) listens and squeezes the hex
// content into the area NOT covered by the panel, so every tile that was on
// screen stays visible beside it (see ZoomDrone #applyInsetReframe).
//
// Why a directive (not a per-component effect): it's the single reusable
// "common system" — any future toolwindow opts in with one attribute. It never
// touches `#pixi-host` (the canvas stays sealed/full per the canvas audit);
// it only reports geometry. Communication is by EffectBus string contract, so
// this shared directive and the essentials consumer never import each other.

import { Directive, ElementRef, Input, inject, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

export type DockSide = 'left' | 'right' | 'top' | 'bottom'

let _counter = 0

/**
 * How long to wait for a frame before measuring anyway.
 *
 * Long enough that a rendering document always answers with its frame first,
 * so the coalescing below behaves exactly as it always did; short enough that
 * a document which is NOT rendering still reserves its edge promptly. See
 * `#schedule`.
 */
const FRAMELESS_RETRY_MS = 60

@Directive({
  selector: '[hcDockInset]',
  standalone: true,
})
export class DockInsetDirective implements OnDestroy {
  readonly #host = inject(ElementRef) as ElementRef<HTMLElement>
  readonly #owner = `dock-${++_counter}`
  #ro: ResizeObserver | null = null
  #offPoll: (() => void) | null = null
  #raf = 0
  #timer = 0
  #side: DockSide = 'right'
  #active = true

  /** Which screen edge the panel docks against. */
  @Input('hcDockInset') set side(v: DockSide) {
    this.#side = v || 'right'
    this.#schedule()
  }

  /** Whether the panel currently reserves space. Panels wrapped in `@if` only
   *  exist while shown, so this defaults true; pass false to hold the inset off
   *  (e.g. notes-strip while floating rather than docked). */
  @Input('hcDockInsetActive') set active(v: boolean) {
    this.#active = v !== false
    this.#schedule()
  }

  constructor() {
    // The host element exists now. Observe its size so the panel's slide-in
    // animation and the user's drag-resize keep the reserved inset in sync.
    this.#ro = new ResizeObserver(() => this.#schedule())
    this.#ro.observe(this.#host.nativeElement)
    window.addEventListener('resize', this.#schedule)

    // A PANEL CAN MOVE WITHOUT RESIZING, and then nothing here notices.
    //
    // What a panel reserves is measured from a POSITION — `innerWidth - left`
    // for a right-docked one — and two ordinary things move a panel without
    // changing its size by a pixel. Re-docking the control bar slides every
    // panel, because each is placed with a `calc()` over `--hc-controls-<side>`.
    // And a lane holding two windows re-places the inner one whenever the
    // outer is resized or closed. A ResizeObserver reports size and nothing
    // else, and `window.resize` never fires for either — so the reservation
    // went quietly stale, and the panel either covered what it was meant to
    // sit beside or left a dead strip where it used to be.
    //
    // Neither mover can work out what the new number should be, and it should
    // not have to: it knows only that it moved something. So there is ONE
    // request, carrying nothing, and every live panel answers it by measuring
    // itself again. A panel that did not move re-announces the number it
    // already had, which costs one `getBoundingClientRect` and no repaint.
    this.#offPoll = EffectBus.on('viewport:inset-poll', this.#schedule)
  }

  ngOnDestroy(): void {
    this.#ro?.disconnect()
    this.#ro = null
    window.removeEventListener('resize', this.#schedule)
    this.#offPoll?.()
    this.#offPoll = null
    if (this.#raf) cancelAnimationFrame(this.#raf)
    if (this.#timer) clearTimeout(this.#timer)
    // @if-unmounted panels clear their reservation here.
    this.#emitClear()
  }

  /**
   * Coalesce input + resize bursts to one measurement, on the next frame or
   * shortly after — WHICHEVER COMES FIRST.
   *
   * A TIMEOUT AS WELL AS A FRAME, and the timeout is the whole point. A
   * document that is not being rendered — a backgrounded tab, an occluded or
   * minimised window — runs no `requestAnimationFrame` callbacks, and it
   * delivers no ResizeObserver callbacks either, since both belong to the
   * rendering steps. A panel opened in that state therefore reserved NOTHING
   * while sitting on top of the very content it is meant to sit beside, and
   * nothing recovered it: the panel's size never changes after it opens, so
   * the observer has nothing to report when rendering resumes, and every one
   * of the four `#schedule()` callers is gated behind the pending frame.
   *
   * Measured, with both tool windows mounted and correctly laid out in a
   * hidden tab: `--hc-inset-left` and `--hc-inset-right` both read `0px`, and
   * one frame later they read `374.67px` and `300.33px`. In the meantime the
   * design canvas ran 153px underneath the right-hand panel.
   *
   * The timer's measurement is every bit as good as the frame's, because
   * `getBoundingClientRect` forces layout whatever the visibility. And in a
   * document that IS rendering the frame always wins the race, so the hot
   * path is untouched. `hc-docked-panel` takes the same precaution for the
   * same reason — "a timeout, not a frame".
   */
  #schedule = (): void => {
    if (this.#raf || this.#timer) return
    this.#raf = requestAnimationFrame(this.#measure)
    this.#timer = window.setTimeout(this.#measure, FRAMELESS_RETRY_MS)
  }

  /** Whichever of the two got here first; the other is called off. */
  #measure = (): void => {
    if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = 0 }
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = 0 }
    this.#emit()
  }

  #emit(): void {
    if (!this.#active) { this.#emitClear(); return }
    const size = reservationFor(this.#side, this.#host.nativeElement.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    if (size <= 0) { this.#emitClear(); return }
    EffectBus.emit('viewport:inset', { owner: this.#owner, side: this.#side, size })
  }

  #emitClear(): void {
    EffectBus.emit('viewport:inset', { owner: this.#owner, side: this.#side, size: 0 })
  }
}

/** The four numbers a DOMRect gives, and nothing else. */
export interface InsetRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/**
 * How much screen edge a panel at `rect` reserves on `side`. Zero means it
 * reserves nothing at all.
 *
 * Pure, and exported, so the three rules that actually matter — a panel with
 * no area reserves nothing, a full-bleed sheet reserves nothing, and each side
 * measures from its own viewport edge — can be argued with in a test instead
 * of in a browser.
 */
export function reservationFor(
  side: DockSide,
  rect: InsetRect,
  viewport: { readonly width: number; readonly height: number },
): number {
  if (rect.width <= 0 || rect.height <= 0) return 0

  // A FULL-BLEED sheet reserves nothing.
  //
  // On a phone several panels flip to a full-width bottom sheet in their own
  // SCSS while still declaring `hcDockInset="right"` — so `innerWidth - left`
  // measured the whole screen and the panel claimed the entire viewport as a
  // right-edge reservation. Everything downstream trusts that number: the
  // canvas host was squeezed to zero width, `--hc-inset-right` pushed the
  // control bar and the edit cluster off-screen, and the full-surface view
  // drones collapsed against it.
  //
  // Report NOTHING rather than guess a replacement edge. Saying `bottom`
  // instead would unblock `resyncToHost` → `zoomToFit`, so opening the sheet
  // would re-scale the whole hive into a letterbox and closing it would
  // re-scale back, on every tap. Today the hive sits still above the sheet,
  // which is what the sheet's own styling asks for. A window that genuinely
  // wants a bottom reservation declares `hcDockInset="bottom"` itself.
  const spansX = rect.left <= 1 && rect.right >= viewport.width - 1
  const spansY = rect.top <= 1 && rect.bottom >= viewport.height - 1
  const horizontal = side === 'left' || side === 'right'
  if (horizontal ? spansX : spansY) return 0

  // Reserve up to the panel's INNER edge against the viewport edge — robust
  // to gaps or a panel not flush to the edge.
  switch (side) {
    case 'left':   return Math.max(0, rect.right)
    case 'right':  return Math.max(0, viewport.width - rect.left)
    case 'top':    return Math.max(0, rect.bottom)
    case 'bottom': return Math.max(0, viewport.height - rect.top)
  }
}
