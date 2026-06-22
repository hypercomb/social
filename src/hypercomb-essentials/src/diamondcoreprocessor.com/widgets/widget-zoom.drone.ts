// diamondcoreprocessor.com/widgets/widget-zoom.drone.ts
//
// WidgetZoomDrone — the externalised "zoomable widget" capability behind the
// hcWidget directive (hypercomb-shared/ui/widget-zoom). Any element tagged
// [data-widget="<id>"] becomes user-scalable: hold Shift while the pointer is
// over it and a compact zoom slider appears, pinned to the widget. Dragging it
// rescales that widget live; the scale is participant-local (localStorage,
// keyed by widget id) and broadcast over EffectBus so the directive reflects
// it as inline `zoom`.
//
// Why a drone owns this: it's a single cross-cutting behaviour serving every
// widget, mirroring how MousewheelZoomInput owns canvas zoom. The slider is
// built imperatively (like HistorySliderDrone) so there's no Angular shell-
// parity surface to keep in sync between web and dev.
//
// Contract with the directive (no static import either way — shared must not
// import essentials; they coordinate purely through the DOM + EffectBus):
//   localStorage key   : 'hc:widget-scale'      → { [id]: number }
//   effect (emitted)   : 'widget:scale-changed' → { id, scale }
//   DOM contract       : [data-widget], [data-widget-anchor]
//
// Scale is applied as CSS `zoom` (not `transform: scale`): verified to keep
// transform-centred modals centred and to not fight the panels' enter-
// animation transforms. See documentation/zoomable-widgets.md.

import { EffectBus } from '@hypercomb/core'

const SCALE_KEY = 'hc:widget-scale'
const MIN = 0.6
const MAX = 2.5
const STEP = 0.05
const SLIDER_ID = 'hc-widget-zoom-slider'

const clamp = (n: number): number =>
  Math.min(MAX, Math.max(MIN, Math.round(n / STEP) * STEP))

export class WidgetZoomDrone {

  #scales: Record<string, number> = this.#load()

  #shift = false
  #hovered: HTMLElement | null = null   // last [data-widget] under the pointer
  #active: HTMLElement | null = null    // widget the slider is currently bound to
  #overSlider = false

  // slider DOM (lazily built on first use)
  #wrap: HTMLElement | null = null
  #range: HTMLInputElement | null = null
  #label: HTMLElement | null = null

  constructor() {
    // capture phase: catch Shift even while a panel input is focused, and see
    // pointer moves before anything can stop propagation.
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('pointermove', this.#onPointerMove, true)
    // Shift may "stick" if the window loses focus mid-press — clear so the
    // slider can't get wedged open.
    window.addEventListener('blur', this.#clearShift)
  }

  // ── persistence (participant-local — never the layer/lineage) ──

  #load(): Record<string, number> {
    try {
      const raw = localStorage.getItem(SCALE_KEY)
      return raw ? JSON.parse(raw) as Record<string, number> : {}
    } catch { return {} }
  }

  #save(): void {
    try { localStorage.setItem(SCALE_KEY, JSON.stringify(this.#scales)) }
    catch { /* quota / private mode — non-fatal, scale just won't persist */ }
  }

  /** Current scale for a widget id (1 when unset). */
  get(id: string): number {
    const v = this.#scales[id]
    return typeof v === 'number' && v > 0 ? v : 1
  }

  /** Set + persist + broadcast a widget's scale. */
  set(id: string, scale: number): void {
    const next = clamp(scale)
    this.#scales[id] = next
    this.#save()
    EffectBus.emit('widget:scale-changed', { id, scale: next })
    // the widget just resized — keep the slider pinned to its new bounds
    if (this.#active && this.#active.dataset['widget'] === id) this.#position(this.#active)
  }

  // ── shift tracking ─────────────────────────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift' && !this.#shift) { this.#shift = true; this.#sync() }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') this.#clearShift()
  }

  #clearShift = (): void => {
    if (!this.#shift) return
    this.#shift = false
    this.#sync()
  }

  // ── hover tracking ─────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    const t = e.target as Element | null
    this.#overSlider = !!t?.closest?.(`#${SLIDER_ID}`)
    this.#hovered = (t?.closest?.('[data-widget]') as HTMLElement | null) ?? null
    if (this.#shift) this.#sync()
  }

  // ── show / hide decision ───────────────────────────────────────
  //
  // Once shown, the slider stays up for as long as Shift is held — it does
  // NOT hide when the pointer drifts across the gap between widget and slider,
  // or out onto the canvas. This avoids flicker and keeps the last-hovered
  // widget under control. Releasing Shift (or blur) hides it.

  #sync(): void {
    if (!this.#shift) { this.#hide(); return }
    if (this.#hovered) { this.#show(this.#hovered); return }
    if (this.#active || this.#overSlider) return   // keep the current slider up
    this.#hide()
  }

  #show(el: HTMLElement): void {
    const id = el.dataset['widget']
    if (!id) return
    this.#build()
    if (this.#active === el) return                // already bound to this widget
    this.#active = el
    if (this.#range) this.#range.value = String(this.get(id))
    this.#updateLabel(this.get(id))
    this.#wrap!.style.display = 'flex'
    this.#position(el)
  }

  #hide(): void {
    if (this.#wrap) this.#wrap.style.display = 'none'
    this.#active = null
  }

  #position(el: HTMLElement): void {
    if (!this.#wrap) return
    const r = el.getBoundingClientRect()   // already-zoomed visible box
    const w = this.#wrap.getBoundingClientRect()
    let left = r.left + r.width / 2 - w.width / 2
    let top = r.top - w.height - 8         // pinned just above the widget
    left = Math.max(8, Math.min(left, window.innerWidth - w.width - 8))
    if (top < 8) top = r.top + 8           // no room above — sit just inside the top
    this.#wrap.style.left = `${Math.round(left)}px`
    this.#wrap.style.top = `${Math.round(top)}px`
  }

  // ── slider DOM ─────────────────────────────────────────────────

  #build(): void {
    if (this.#wrap) return

    const wrap = document.createElement('div')
    wrap.id = SLIDER_ID
    // wheel over the slider must adjust the slider, not the canvas — the
    // mousewheel-zoom handler already bails on [data-consumes-wheel].
    wrap.setAttribute('data-consumes-wheel', '')
    wrap.style.cssText = `
      position: fixed; z-index: 100002; display: none;
      align-items: center; gap: 8px;
      padding: 6px 10px;
      background: rgba(14, 18, 24, 0.94);
      border: 1px solid rgba(126, 182, 214, 0.28);
      border-radius: 8px;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
      font-family: var(--hc-mono); font-size: 11px;
      color: rgba(235, 242, 248, 0.82);
      user-select: none; pointer-events: auto;
    `
    wrap.addEventListener('pointerenter', () => { this.#overSlider = true })
    wrap.addEventListener('pointerleave', () => { this.#overSlider = false; this.#sync() })
    wrap.addEventListener('wheel', this.#onWheel, { passive: false })

    const icon = document.createElement('span')
    icon.textContent = '⤢'
    icon.style.cssText = 'opacity: 0.6; font-size: 12px;'

    const range = document.createElement('input')
    range.type = 'range'
    range.min = String(MIN)
    range.max = String(MAX)
    range.step = String(STEP)
    range.value = '1'
    range.title = 'Drag to scale · double-click to reset'
    range.style.cssText = 'width: 120px; accent-color: rgba(126, 182, 214, 0.9); cursor: pointer;'
    range.addEventListener('input', () => {
      if (!this.#active) return
      const v = parseFloat(range.value)
      this.set(this.#active.dataset['widget']!, v)
      this.#updateLabel(v)
    })
    range.addEventListener('dblclick', () => {
      if (!this.#active) return
      this.set(this.#active.dataset['widget']!, 1)
      range.value = '1'
      this.#updateLabel(1)
    })

    const label = document.createElement('span')
    label.style.cssText = 'min-width: 34px; text-align: right; opacity: 0.7;'

    wrap.append(icon, range, label)
    document.body.appendChild(wrap)

    this.#wrap = wrap
    this.#range = range
    this.#label = label
  }

  #updateLabel(scale: number): void {
    if (this.#label) this.#label.textContent = `${Math.round(scale * 100)}%`
  }

  #onWheel = (e: WheelEvent): void => {
    if (!this.#active) return
    e.preventDefault()
    const id = this.#active.dataset['widget']!
    this.set(id, this.get(id) + (e.deltaY < 0 ? STEP : -STEP))
    if (this.#range) this.#range.value = String(this.get(id))
    this.#updateLabel(this.get(id))
  }
}

const _widgetZoom = new WidgetZoomDrone()
window.ioc.register('@diamondcoreprocessor.com/WidgetZoomDrone', _widgetZoom)
