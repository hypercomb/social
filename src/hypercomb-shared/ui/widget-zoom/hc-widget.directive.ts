// hypercomb-shared/ui/widget-zoom/hc-widget.directive.ts
//
// hcWidget — opt-in "zoomable widget" behaviour. Stamp this on a floating
// panel / overlay / sidebar / toolbar's OUTERMOST container and it becomes
// user-scalable: hold Shift while hovering it and a zoom slider appears
// (owned by the WidgetZoomDrone). The scale is participant-local — persisted
// in localStorage, never in the layer/lineage signature.
//
//   <div class="sheet-panel" hcWidget="shortcut-sheet" anchor="center">…</div>
//
// Harness-fixed chrome (command line, header indicators) deliberately does NOT
// opt in — only free-floating content does. This directive carries no opinion
// about that; it just zooms whatever it's placed on.
//
// Mechanics:
//  - tags the element [data-widget="<id>"] — the contract the drone hovers on
//  - applies the persisted scale as inline `zoom` (kept centred for
//    transform-centred modals; doesn't fight enter-animation transforms)
//  - reflects live scale changes the drone broadcasts over EffectBus
//
// Contract shared with diamondcoreprocessor.com/widgets/widget-zoom.drone.ts
// (coordinated purely via the DOM attribute + EffectBus — shared must never
// statically import essentials):
//   localStorage key : 'hc:widget-scale'      → { [id]: number }
//   effect           : 'widget:scale-changed' → { id, scale }

// THE MECHANICS MOVED TO CORE (core/panels/widget-zoom.ts) in the
// everything-is-a-beehavior Phase 2 — they were never Angular-shaped. This
// directive is now the thin Angular adapter over them, so a converted
// element and an un-converted component zoom through the SAME code and the
// same persisted scale for the whole transition.
import { Directive, ElementRef, Input, inject, type OnDestroy, type OnInit } from '@angular/core'
import { attachWidgetZoom, type WidgetAnchor } from '@hypercomb/core'

export type { WidgetAnchor } from '@hypercomb/core'

@Directive({
  selector: '[hcWidget]',
  standalone: true,
})
export class HcWidgetDirective implements OnInit, OnDestroy {

  /** Stable participant-local widget id (persistence + hover key). */
  @Input('hcWidget') id = ''

  /** Position-balancing hint. CSS `zoom` keeps most anchored layouts correct
   *  on its own, so this is advisory for the slider/drone for now. */
  @Input() anchor: WidgetAnchor = 'center'

  readonly #el: HTMLElement = inject(ElementRef).nativeElement
  #unsub: (() => void) | null = null

  ngOnInit(): void {
    this.#unsub = attachWidgetZoom(this.#el, this.id, this.anchor)
  }

  ngOnDestroy(): void {
    this.#unsub?.()
  }
}
