// editor/crop-stage.ts
//
// THE PICTURE UNDER THE PARTICIPANT'S HANDS.
//
// A square stage holding the original picture as a plain <img> moved by a
// compositor transform, the tile's look drawn over it, and the gestures that
// frame it:
//
//   drag            pan (the pointer is captured, so a release outside the
//                   stage still ends the drag)
//   two fingers     zoom about their centroid and carry the picture with it;
//                   lifting one hands over to a pan with no jump
//   wheel / pinch   zoom about the cursor (a trackpad pinch arrives as a wheel
//   on a trackpad   with ctrlKey and steps finer)
//   double-click    toggle between filling and twice filling, about the point
//   arrows, + - 0 F pan, zoom, reset, Fit — while the stage has focus
//
// Past a limit a gesture shows only a share of the overshoot and settles back
// when released. The framing STORED in the model is always the clamped one;
// the rubber band is display only.
//
// The stage owns no framing of its own. It reads `ImageEditorService` and
// writes back to it; the view re-renders from the model's change event.

import {
  clampFraming,
  clientToFrame,
  coverScale,
  frameSize,
  pinchFraming,
  rubberBand,
  zoomAbout,
  zoomToward,
  type Framing,
  type Point,
} from './crop-math.js'
import { TileLookOverlay, type TileLook } from './tile-look-overlay.js'
import type { ImageEditorService } from './image-editor.service.js'

const SETTLE_MS = 180
const WHEEL_STEP = 0.0015
const PINCH_WHEEL_STEP = 0.01
const KEY_ZOOM = 1.1

const prefersReducedMotion = (): boolean => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

const lerp = (a: Framing, b: Framing, t: number): Framing => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  scale: a.scale * Math.pow(b.scale / a.scale, t),
})

export type StageLook = Pick<TileLook, 'border' | 'name' | 'showName'>

export class CropStage {
  readonly el: HTMLDivElement
  readonly overlay = new TileLookOverlay()

  #model: ImageEditorService
  #picture: HTMLImageElement
  #look: StageLook = { border: '', name: '', showName: true }
  #onCommit: () => void

  /** The framing on screen while a gesture or a settle is in progress. */
  #live: Framing | null = null
  #pointers = new Map<number, Point>()
  #pan: { start: Framing; from: Point } | null = null
  #pinch: { start: Framing; centroid: Point; distance: number } | null = null
  #settleFrame = 0
  #commitTimer = 0
  #observer: ResizeObserver | null = null
  #size = 0
  #baseKey = ''

  constructor(model: ImageEditorService, onCommit: () => void) {
    this.#model = model
    this.#onCommit = onCommit

    this.el = document.createElement('div')
    this.el.className = 'te-stage'
    this.el.setAttribute('data-role', 'crop-stage')
    this.el.setAttribute('data-consumes-wheel', '')
    this.el.tabIndex = 0

    this.#picture = document.createElement('img')
    this.#picture.className = 'te-stage-picture'
    this.#picture.alt = ''
    this.#picture.draggable = false
    this.#picture.decoding = 'async'

    this.el.append(this.#picture, this.overlay.svg, this.overlay.name)

    this.el.addEventListener('pointerdown', this.#onPointerDown)
    this.el.addEventListener('pointermove', this.#onPointerMove)
    this.el.addEventListener('pointerup', this.#onPointerEnd)
    this.el.addEventListener('pointercancel', this.#onPointerEnd)
    this.el.addEventListener('lostpointercapture', this.#onPointerEnd)
    this.el.addEventListener('wheel', this.#onWheel, { passive: false })
    this.el.addEventListener('dblclick', this.#onDoubleClick)
    this.el.addEventListener('keydown', this.#onKeyDown)
    // Safari's own pinch would zoom the page under the stage.
    this.el.addEventListener('gesturestart', this.#prevent as EventListener)
    this.el.addEventListener('gesturechange', this.#prevent as EventListener)

    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.render())
      this.#observer.observe(this.el)
    }
  }

  setLook(look: StageLook): void {
    this.#look = look
    this.render()
  }

  get gesturing(): boolean { return this.#pan !== null || this.#pinch !== null }

  dispose(): void {
    this.#observer?.disconnect()
    this.#observer = null
    if (this.#settleFrame) cancelAnimationFrame(this.#settleFrame)
    if (this.#commitTimer) clearTimeout(this.#commitTimer)
    this.#pointers.clear()
    this.#pan = null
    this.#pinch = null
    this.el.remove()
  }

  // ── drawing ───────────────────────────────────────────────────

  render(): void {
    const model = this.#model
    const size = this.el.clientWidth || this.#size
    if (size > 0) this.#size = size
    const natural = model.natural
    const side = model.side
    const hasPicture = model.hasImage && !!natural

    this.el.dataset['state'] = hasPicture ? 'picture' : model.loading ? 'loading' : 'empty'
    this.el.dataset['orientation'] = model.orientation

    if (hasPicture && natural && size > 0) {
      if (this.#picture.getAttribute('src') !== model.url) this.#picture.src = model.url
      const frame = frameSize(side)
      const k = size / frame
      // The element is laid out once at its covering size and scaled from
      // there, so a gesture moves a compositor layer about the size of the
      // stage rather than re-rastering a 4000px photo every frame.
      const cover = coverScale(natural, { width: frame, height: frame })
      const baseWidth = natural.width * cover * k
      const baseHeight = natural.height * cover * k
      const key = `${baseWidth.toFixed(2)}x${baseHeight.toFixed(2)}`
      if (key !== this.#baseKey) {
        this.#baseKey = key
        this.#picture.style.width = `${baseWidth}px`
        this.#picture.style.height = `${baseHeight}px`
      }
      const framing = this.#live ?? model.framingFor()
      const ratio = framing.scale / cover
      const left = size / 2 + framing.x * k - (baseWidth * ratio) / 2
      const top = size / 2 + framing.y * k - (baseHeight * ratio) / 2
      this.#picture.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${ratio})`
      this.#picture.hidden = false
    } else {
      this.#picture.hidden = true
      if (!hasPicture && this.#picture.getAttribute('src')) this.#picture.removeAttribute('src')
      this.#baseKey = ''
    }

    this.overlay.update(size, side, {
      orientation: model.orientation,
      border: this.#look.border,
      name: this.#look.name,
      // An empty tile always shows its name — the renderer only hides names
      // over a picture.
      showName: this.#look.showName || !hasPicture,
      hasPicture,
      dragging: this.gesturing,
    })
  }

  // ── pointer gestures ──────────────────────────────────────────

  #frameAt(client: Point): Point {
    const rect = this.el.getBoundingClientRect()
    return clientToFrame(client, rect, this.#model.side)
  }

  #current(): Framing {
    return this.#live ?? this.#model.framingFor()
  }

  #clamped(framing: Framing): Framing {
    const natural = this.#model.natural
    if (!natural) return framing
    return clampFraming(framing, natural, this.#model.boxFor(), this.#model.mode)
  }

  #show(raw: Framing): void {
    this.#live = rubberBand(raw, this.#clamped(raw))
    this.render()
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#model.hasImage) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    this.#cancelSettle()
    // A primary press with stale ids still tracked means an earlier release
    // never arrived (a system gesture, a lost capture) — start clean.
    if (e.isPrimary && this.#pointers.size > 0) this.#pointers.clear()
    try { this.el.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.preventDefault()
    this.el.focus({ preventScroll: true })
    this.#beginFromPointers()
  }

  #beginFromPointers(): void {
    const current = this.#clamped(this.#current())
    const tracked = [...this.#pointers.values()]
    if (tracked.length >= 2) {
      const [a, b] = tracked
      this.#pan = null
      this.#pinch = {
        start: current,
        centroid: this.#frameAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        distance: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      }
    } else if (tracked.length === 1) {
      this.#pinch = null
      this.#pan = { start: current, from: this.#frameAt(tracked[0]) }
    }
    this.el.dataset['gesture'] = this.#pinch ? 'pinch' : this.#pan ? 'pan' : ''
    this.render()
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#pointers.has(e.pointerId)) return
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const tracked = [...this.#pointers.values()]
    if (this.#pinch && tracked.length >= 2) {
      const [a, b] = tracked
      const ratio = (Math.hypot(b.x - a.x, b.y - a.y) || 1) / this.#pinch.distance
      const centroid = this.#frameAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      this.#show(pinchFraming(this.#pinch.start, this.#pinch.centroid, centroid, ratio))
    } else if (this.#pan) {
      const at = this.#frameAt(tracked[0])
      this.#show({
        x: this.#pan.start.x + (at.x - this.#pan.from.x),
        y: this.#pan.start.y + (at.y - this.#pan.from.y),
        scale: this.#pan.start.scale,
      })
    }
  }

  #onPointerEnd = (e: PointerEvent): void => {
    if (!this.#pointers.delete(e.pointerId)) return
    if (this.#pointers.size > 0) {
      // One finger of a pinch lifted: carry on as a pan from where the picture
      // is now, so nothing jumps.
      this.#live = this.#clamped(this.#current())
      this.#beginFromPointers()
      return
    }
    this.#pan = null
    this.#pinch = null
    this.el.dataset['gesture'] = ''
    this.#settleTo(this.#clamped(this.#current()))
  }

  #settleTo(target: Framing): void {
    const from = this.#live
    if (!from || prefersReducedMotion()) {
      this.#commit(target)
      return
    }
    const started = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / SETTLE_MS)
      this.#live = lerp(from, target, easeOut(t))
      this.render()
      if (t < 1) this.#settleFrame = requestAnimationFrame(step)
      else { this.#settleFrame = 0; this.#commit(target) }
    }
    this.#settleFrame = requestAnimationFrame(step)
  }

  #cancelSettle(): void {
    if (!this.#settleFrame) return
    cancelAnimationFrame(this.#settleFrame)
    this.#settleFrame = 0
  }

  #commit(framing: Framing, immediate = true): void {
    this.#live = null
    this.#model.setFraming(framing)
    if (this.#commitTimer) clearTimeout(this.#commitTimer)
    if (immediate) this.#onCommit()
    else this.#commitTimer = window.setTimeout(() => { this.#commitTimer = 0; this.#onCommit() }, 150)
  }

  // ── wheel, double-click, keys ─────────────────────────────────

  #onWheel = (e: WheelEvent): void => {
    if (!this.#model.hasImage) return
    e.preventDefault()
    e.stopPropagation()
    this.#cancelSettle()
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
    const factor = Math.exp(-delta * (e.ctrlKey ? PINCH_WHEEL_STEP : WHEEL_STEP))
    const natural = this.#model.natural
    if (!natural) return
    const current = this.#clamped(this.#current())
    const at = this.#frameAt({ x: e.clientX, y: e.clientY })
    this.#commit(zoomToward(current, current.scale * factor, at, natural, this.#model.boxFor(), this.#model.mode), false)
  }

  #onDoubleClick = (e: MouseEvent): void => {
    const natural = this.#model.natural
    if (!natural) return
    e.preventDefault()
    const cover = coverScale(natural, this.#model.boxFor())
    const current = this.#clamped(this.#current())
    const next = current.scale > cover * 1.5 ? cover : cover * 2
    const target = zoomToward(current, next, this.#frameAt({ x: e.clientX, y: e.clientY }), natural, this.#model.boxFor(), this.#model.mode)
    this.#live = current
    this.#settleTo(target)
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#model.hasImage || e.isComposing) return
    const current = this.#clamped(this.#current())
    const step = e.shiftKey ? 10 : 1
    let next: Framing | null = null
    switch (e.key) {
      case 'ArrowLeft': next = { ...current, x: current.x - step }; break
      case 'ArrowRight': next = { ...current, x: current.x + step }; break
      case 'ArrowUp': next = { ...current, y: current.y - step }; break
      case 'ArrowDown': next = { ...current, y: current.y + step }; break
      case '+':
      case '=': next = zoomToward(current, current.scale * KEY_ZOOM, { x: 0, y: 0 }, this.#model.natural!, this.#model.boxFor(), this.#model.mode); break
      case '-':
      case '_': next = zoomToward(current, current.scale / KEY_ZOOM, { x: 0, y: 0 }, this.#model.natural!, this.#model.boxFor(), this.#model.mode); break
      case '0':
        e.preventDefault(); e.stopPropagation()
        this.#model.resetFraming()
        this.#onCommit()
        return
      case 'f':
      case 'F':
        if (e.ctrlKey || e.metaKey || e.altKey) return
        e.preventDefault(); e.stopPropagation()
        this.#model.setMode(this.#model.mode === 'fit' ? 'fill' : 'fit')
        this.#onCommit()
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    this.#commit(this.#clamped(next), false)
  }

  #prevent = (e: Event): void => { e.preventDefault() }
}
