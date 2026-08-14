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

@Directive({
  selector: '[hcDockInset]',
  standalone: true,
})
export class DockInsetDirective implements OnDestroy {
  readonly #host = inject(ElementRef) as ElementRef<HTMLElement>
  readonly #owner = `dock-${++_counter}`
  #ro: ResizeObserver | null = null
  #raf = 0
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
  }

  ngOnDestroy(): void {
    this.#ro?.disconnect()
    this.#ro = null
    window.removeEventListener('resize', this.#schedule)
    if (this.#raf) cancelAnimationFrame(this.#raf)
    // @if-unmounted panels clear their reservation here.
    this.#emitClear()
  }

  // Coalesce input + resize bursts to one measurement per frame.
  #schedule = (): void => {
    if (this.#raf) return
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0
      this.#emit()
    })
  }

  #emit(): void {
    if (!this.#active) { this.#emitClear(); return }
    const r = this.#host.nativeElement.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) { this.#emitClear(); return }

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
    const spansX = r.left <= 1 && r.right >= window.innerWidth - 1
    const spansY = r.top <= 1 && r.bottom >= window.innerHeight - 1
    const horizontal = this.#side === 'left' || this.#side === 'right'
    if (horizontal ? spansX : spansY) { this.#emitClear(); return }
    // Reserve up to the panel's INNER edge against the viewport edge — robust
    // to gaps or a panel not flush to the edge.
    let size = 0
    switch (this.#side) {
      case 'left':   size = Math.max(0, r.right); break
      case 'right':  size = Math.max(0, window.innerWidth - r.left); break
      case 'top':    size = Math.max(0, r.bottom); break
      case 'bottom': size = Math.max(0, window.innerHeight - r.top); break
    }
    EffectBus.emit('viewport:inset', { owner: this.#owner, side: this.#side, size })
  }

  #emitClear(): void {
    EffectBus.emit('viewport:inset', { owner: this.#owner, side: this.#side, size: 0 })
  }
}
