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

import { Directive, ElementRef, Input, inject, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

export type WidgetAnchor =
  | 'center' | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const SCALE_KEY = 'hc:widget-scale'

/** Read a widget's persisted scale straight from localStorage (no dependency
 *  on the drone being registered yet — robust to boot order on web, where
 *  drones load from OPFS after the Angular shell). */
const readScale = (id: string): number => {
  try {
    const raw = localStorage.getItem(SCALE_KEY)
    const map = raw ? JSON.parse(raw) as Record<string, number> : {}
    const v = map[id]
    return typeof v === 'number' && v > 0 ? v : 1
  } catch { return 1 }
}

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
    if (!this.id) return
    this.#el.dataset['widget'] = this.id
    this.#el.dataset['widgetAnchor'] = this.anchor
    this.#apply(readScale(this.id))
    this.#unsub = EffectBus.on<{ id: string; scale: number }>(
      'widget:scale-changed',
      (p) => { if (p?.id === this.id) this.#apply(p.scale) },
    )
  }

  #apply(scale: number): void {
    // inline `zoom` (setProperty sidesteps TS lib typing for `zoom`)
    this.#el.style.setProperty('zoom', String(scale))
  }

  ngOnDestroy(): void {
    this.#unsub?.()
  }
}
