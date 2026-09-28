// dock-inset.directive.ts — the common toolwindow inset producer.
//
// Drop `[hcDockInset]="'right'"` on a docked panel's root element and it
// broadcasts how much screen edge that panel reserves via the `viewport:inset`
// EffectBus contract. The zoom drone (essentials) listens and squeezes the hex
// content into the area NOT covered by the panel, so every tile that was on
// screen stays visible beside it (see ZoomDrone #applyInsetReframe).
//
// The reservation itself is the tool window's base layer and lives in core
// (`core/panels/dock-inset.ts`), framework-free, where `DockedPanel` gives it
// to every framework-free docked window. This directive is the Angular
// adapter over it and nothing more.

import { Directive, ElementRef, Input, inject, type OnDestroy } from '@angular/core'
import { DockInset, reservationFor, type DockSide, type InsetRect } from '@hypercomb/core'

export { reservationFor, type DockSide, type InsetRect }

@Directive({
  selector: '[hcDockInset]',
  standalone: true,
})
export class DockInsetDirective implements OnDestroy {
  readonly #inset = new DockInset((inject(ElementRef) as ElementRef<HTMLElement>).nativeElement)

  @Input('hcDockInset') set side(v: DockSide) {
    this.#inset.side = v || 'right'
  }

  @Input('hcDockInsetActive') set active(v: boolean) {
    this.#inset.active = v !== false
  }

  constructor() {
    this.#inset.start()
  }

  ngOnDestroy(): void {
    this.#inset.stop()
  }
}
