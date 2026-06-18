// diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input.ts
import type { InputGate } from '../input-gate.service.js'
import type { InputMode, InputModeStack } from '../input-mode-stack.service.js'

type Point = { x: number; y: number }

// Predefined snap levels for coarse zoom (no modifier key)
const SNAP_LEVELS = [
  0.2, 0.25, 0.33, 0.5,
  0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0,
  6.0, 8.0, 12.0,
]

export class MousewheelZoomInput {
  private enabled = false
  private canvas: HTMLCanvasElement | null = null

  // fine-grained step used when Ctrl is held
  private readonly fineStep = 1.02

  private zoom: {
    zoomByFactor: (factor: number, pivot: Point) => void
    zoomToScale: (scale: number, pivot: Point) => void
    currentScale: () => number
  } | null = null

  private gate: InputGate | null = null
  private stack: InputModeStack | null = null
  #mode: InputMode | null = null

  /** Registers this wheel-zoom handler as the default input mode on the
   *  InputModeStack so other modes (notes-hover, future overlays) can
   *  mechanically suspend it by pushing on top. Fallback to direct
   *  window.addEventListener if the stack isn't available (defensive —
   *  shouldn't happen in normal boot order, but keeps the bee functional
   *  if its dependencies haven't loaded). */
  public attach = (
    zoom: {
      zoomByFactor: (factor: number, pivot: Point) => void
      zoomToScale: (scale: number, pivot: Point) => void
      currentScale: () => number
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.zoom = zoom
    this.canvas = canvas
    this.gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null
    this.stack = window.ioc.get<InputModeStack>('@diamondcoreprocessor.com/InputModeStack') ?? null

    // canvas has pointer-events:none so this must be global
    // gating uses the canvas rect so behavior matches "over the container"
    if (this.stack) {
      this.#mode = {
        name: 'hex-grid-wheel-zoom',
        mount: () => window.addEventListener('wheel', this.onWheel, { passive: false }),
        unmount: () => window.removeEventListener('wheel', this.onWheel),
      }
      this.stack.push(this.#mode)
    } else {
      window.addEventListener('wheel', this.onWheel, { passive: false })
    }
    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    if (this.stack && this.#mode) {
      // Force-remove regardless of position — detach may run while a
      // notes-hover (or other) mode is layered above us.
      this.stack.remove(this.#mode.name)
      this.#mode = null
    } else {
      window.removeEventListener('wheel', this.onWheel)
    }

    this.zoom = null
    this.canvas = null
    this.gate = null
    this.stack = null
    this.enabled = false
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.zoom || !this.canvas) return

    // Wheel zoom is always-on. UI that needs to take precedence does so
    // structurally — by pushing its own mode onto InputModeStack (which
    // unmounts this listener entirely) or by tagging its scroll surface
    // with [data-consumes-wheel] (handled below). Transient input claims
    // on the legacy InputGate (touch-coordinator pan/pinch/momentum,
    // selection drag, spacebar pan) are NOT a reason to silently drop
    // wheel events — those gestures don't conflict with wheel zoom, and
    // any leaked claim would otherwise leave wheel scrolling permanently
    // dead until an escape-cascade clear.

    // bail if the event is aimed at a UI surface that wants to consume
    // wheel itself (scrollable panels marked [data-consumes-wheel]).
    // Canvas is full-screen so geometric rect checks alone wouldn't
    // distinguish "over the history viewer overlay" from "over the
    // canvas beneath it".
    const target = event.target as Element | null
    if (target?.closest?.('[data-consumes-wheel]')) return

    const rect = this.canvas.getBoundingClientRect()
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) return

    // While the input gate is locked (a fixed overlay such as the editor
    // is up), suppress wheel zoom entirely — the canvas underneath must
    // not move beneath the overlay. Touch pinch/pan already bail in the
    // same case via the gate's claim() guard; this keeps wheel consistent.
    // Flash the command-line lock indicator so the user knows why the
    // wheel did nothing.
    if (this.gate?.locked) {
      this.gate.notifyLockedAttempt()
      return
    }

    const pivot = { x: event.clientX, y: event.clientY }
    const zoomIn = event.deltaY < 0

    if (event.ctrlKey || event.metaKey) {
      // fine-grained smooth zoom when Ctrl/Cmd is held
      const factor = zoomIn ? this.fineStep : 1 / this.fineStep
      this.zoom.zoomByFactor(factor, pivot)
    } else {
      // snap to next/previous level
      const current = this.zoom.currentScale()
      const next = this.#nextSnapLevel(current, zoomIn)
      if (next !== current) {
        this.zoom.zoomToScale(next, pivot)
      }
    }

    event.preventDefault()
    event.stopPropagation()
  }

  #nextSnapLevel = (current: number, zoomIn: boolean): number => {
    if (zoomIn) {
      // find next level above current
      for (const level of SNAP_LEVELS) {
        if (level > current + 0.001) return level
      }
      return SNAP_LEVELS[SNAP_LEVELS.length - 1]
    } else {
      // find next level below current
      for (let i = SNAP_LEVELS.length - 1; i >= 0; i--) {
        if (SNAP_LEVELS[i] < current - 0.001) return SNAP_LEVELS[i]
      }
      return SNAP_LEVELS[0]
    }
  }
}

window.ioc.register('@diamondcoreprocessor.com/MousewheelZoomInput', new MousewheelZoomInput())
