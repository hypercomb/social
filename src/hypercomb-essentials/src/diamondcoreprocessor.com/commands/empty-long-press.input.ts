// diamondcoreprocessor.com/commands/empty-long-press.input.ts
//
// Mobile-only gesture: long-press anywhere on the canvas where there is
// NOT a tile under the pointer reveals the command-line at the top of
// the screen so the user can type to create a tile. Releasing or moving
// past the jitter threshold cancels.
//
// The command-line itself isn't owned by this drone — we just emit
// `mobile:input-visible` { visible: true, mobile: true }. The shared
// command-line component listens for that and reveals itself; the App
// component listens too and un-hides the header-bar that contains it.

import { Point } from 'pixi.js'
import { EffectBus } from '@hypercomb/core'
import type { Axial } from '../navigation/hex-detector.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'

type CellCountPayload = { count: number; coords?: Axial[] }

const HOLD_MS = 500
const JITTER_PX = 12

function axialKey(q: number, r: number): string {
  return `${q},${r}`
}

export class EmptyLongPressInput {
  #canvas: HTMLCanvasElement | null = null
  #container: any = null
  #renderer: any = null
  #meshOffset = { x: 0, y: 0 }
  #flat = false

  #occupied = new Set<string>()

  #holdTimer: ReturnType<typeof setTimeout> | null = null
  #downPos: { x: number; y: number } | null = null
  #activePointerId: number | null = null
  #attached = false

  constructor() {
    EffectBus.on<HostReadyPayload>('render:host-ready', (payload) => {
      this.#canvas = payload.canvas
      this.#container = payload.container
      this.#renderer = payload.renderer
      this.#attach()
    })

    EffectBus.on<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
    })

    EffectBus.on<{ flat: boolean }>('render:set-orientation', ({ flat }) => {
      this.#flat = !!flat
    })

    EffectBus.on<CellCountPayload>('render:cell-count', ({ coords }) => {
      this.#occupied.clear()
      if (!coords) return
      for (const c of coords) {
        if (c) this.#occupied.add(axialKey(c.q, c.r))
      }
    })
  }

  #attach(): void {
    if (this.#attached) return
    window.addEventListener('pointerdown', this.#onPointerDown, { passive: false })
    window.addEventListener('pointermove', this.#onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.#onPointerUp, { passive: false })
    window.addEventListener('pointercancel', this.#onPointerUp, { passive: false })
    this.#attached = true
  }

  #isMobile(): boolean {
    return window.matchMedia('(max-width: 599px), (max-height: 599px)').matches
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (!this.#canvas || !this.#isMobile()) return

    // Only the first finger triggers; multi-touch is for pan/pinch.
    if (this.#activePointerId !== null) {
      this.#cancel()
      return
    }

    const rect = this.#canvas.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) return

    // Don't fire over UI chrome (controls bar etc) — bail if the event
    // target isn't the canvas itself.
    const target = e.target as HTMLElement | null
    if (target && target !== this.#canvas) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (!axial) return

    // If a tile already lives at this hex, this is not an "empty area"
    // long-press — let tile-selection / move handle it.
    if (this.#occupied.has(axialKey(axial.q, axial.r))) return

    this.#activePointerId = e.pointerId
    this.#downPos = { x: e.clientX, y: e.clientY }

    this.#holdTimer = setTimeout(() => {
      this.#holdTimer = null
      // haptic confirm
      try { navigator.vibrate?.(40) } catch { /* ignore */ }
      EffectBus.emit('mobile:input-visible', { visible: true, mobile: true })
      this.#reset()
    }, HOLD_MS)
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (e.pointerId !== this.#activePointerId) return
    if (!this.#holdTimer || !this.#downPos) return

    const dx = e.clientX - this.#downPos.x
    const dy = e.clientY - this.#downPos.y
    if (Math.abs(dx) > JITTER_PX || Math.abs(dy) > JITTER_PX) {
      this.#cancel()
    }
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (e.pointerId !== this.#activePointerId) return
    this.#cancel()
  }

  #cancel(): void {
    if (this.#holdTimer) {
      clearTimeout(this.#holdTimer)
      this.#holdTimer = null
    }
    this.#reset()
  }

  #reset(): void {
    this.#downPos = null
    this.#activePointerId = null
  }

  #clientToAxial(cx: number, cy: number): Axial | null {
    if (!this.#container || !this.#renderer) return null

    const detector = window.ioc.get<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>(
      '@diamondcoreprocessor.com/HexDetector'
    )
    if (!detector) return null

    const events = this.#renderer?.events
    let gx: number, gy: number
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      gx = out.x; gy = out.y
    } else {
      const rect = this.#canvas!.getBoundingClientRect()
      const screen = this.#renderer!.screen
      gx = (cx - rect.left) * (screen.width / rect.width)
      gy = (cy - rect.top) * (screen.height / rect.height)
    }
    const local = this.#container.toLocal(new Point(gx, gy))
    return detector.pixelToAxial(local.x - this.#meshOffset.x, local.y - this.#meshOffset.y, this.#flat)
  }
}

const _emptyLongPress = new EmptyLongPressInput()
window.ioc.register('@diamondcoreprocessor.com/EmptyLongPressInput', _emptyLongPress)
