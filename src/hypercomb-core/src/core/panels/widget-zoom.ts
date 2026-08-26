// widget-zoom.ts — opt-in "zoomable widget" behaviour, framework-free.
//
// Moved from the Angular `hcWidget` directive in the everything-is-a-beehavior
// Phase 2: it was never really a directive, only ~30 lines that tag an element,
// read a persisted scale and follow one effect. As a function it serves both
// kits — the Angular directive delegates to it while the shell lasts, and a
// converted element calls it directly.
//
// Stamp it on a floating panel / overlay / sidebar / toolbar's OUTERMOST
// container and it becomes user-scalable: hold Shift while hovering it and a
// zoom slider appears (owned by the WidgetZoomDrone). The scale is
// participant-local — persisted in localStorage, never in the layer/lineage
// signature.
//
// Harness-fixed chrome (command line, header indicators) deliberately does NOT
// opt in — only free-floating content does. This carries no opinion about
// that; it just zooms whatever it is given.
//
// Contract shared with diamondcoreprocessor.com/widgets/widget-zoom.drone.ts
// (coordinated purely via the DOM attribute + EffectBus, so neither side
// imports the other):
//   localStorage key : 'hc:widget-scale'      → { [id]: number }
//   effect           : 'widget:scale-changed' → { id, scale }

import { EffectBus } from '../../effect-bus.js'

export type WidgetAnchor =
  | 'center' | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const SCALE_KEY = 'hc:widget-scale'

/** Read a widget's persisted scale straight from localStorage (no dependency
 *  on the drone being registered yet — robust to boot order on web, where
 *  drones load from OPFS after the shell). */
export const readWidgetScale = (id: string): number => {
  try {
    const raw = localStorage.getItem(SCALE_KEY)
    const map = raw ? JSON.parse(raw) as Record<string, number> : {}
    const v = map[id]
    return typeof v === 'number' && v > 0 ? v : 1
  } catch { return 1 }
}

/**
 * Make `el` a zoomable widget. Returns the teardown — call it when the
 * element goes away, or the effect subscription outlives what it scales.
 *
 * A blank id is a no-op (and returns a no-op teardown), matching the
 * directive's behaviour for an unstamped host.
 */
export function attachWidgetZoom(
  el: HTMLElement,
  id: string,
  anchor: WidgetAnchor = 'center',
): () => void {
  if (!id) return () => { /* nothing was attached */ }

  el.dataset['widget'] = id
  el.dataset['widgetAnchor'] = anchor

  // inline `zoom` (setProperty sidesteps TS lib typing for `zoom`)
  const apply = (scale: number): void => { el.style.setProperty('zoom', String(scale)) }
  apply(readWidgetScale(id))

  return EffectBus.on<{ id: string; scale: number }>(
    'widget:scale-changed',
    (p) => { if (p?.id === id) apply(p.scale) },
  )
}
