// diamondcoreprocessor.com/input/move/desktop-move.input.ts
import { Point } from 'pixi.js'
import type { Axial } from '../navigation/hex-detector.js'
import type { MoveDroneApi } from './move.drone.js'

type MoveRefs = {
  canvas: HTMLCanvasElement
  container: any
  renderer: any
  getMeshOffset: () => { x: number; y: number }
}

export class DesktopMoveInput {
  #enabled = false
  #canvas: HTMLCanvasElement | null = null
  #container: any = null
  #renderer: any = null
  #getMeshOffset: (() => { x: number; y: number }) | null = null

  #drone: MoveDroneApi | null = null

  readonly #source = 'desktop-move'
  readonly #threshold = 6

  #downPos: { x: number; y: number } | null = null
  #downAxial: Axial | null = null
  #dragging = false
  #spaceHeld = false
  #ctrlHeld = false
  #lastDwellLabel: string | null = null

  attach = (drone: MoveDroneApi, refs: MoveRefs): void => {
    if (this.#enabled) return

    this.#drone = drone
    this.#canvas = refs.canvas
    this.#container = refs.container
    this.#renderer = refs.renderer
    this.#getMeshOffset = refs.getMeshOffset

    document.addEventListener('pointerdown', this.#onPointerDown)
    document.addEventListener('pointermove', this.#onPointerMove)
    document.addEventListener('pointerup', this.#onPointerUp)
    document.addEventListener('pointercancel', this.#onPointerUp)
    document.addEventListener('keydown', this.#onKeyDown)
    document.addEventListener('keyup', this.#onKeyUp)
    window.addEventListener('blur', this.#onBlur)

    this.#enabled = true
  }

  detach = (): void => {
    if (!this.#enabled) return

    document.removeEventListener('pointerdown', this.#onPointerDown)
    document.removeEventListener('pointermove', this.#onPointerMove)
    document.removeEventListener('pointerup', this.#onPointerUp)
    document.removeEventListener('pointercancel', this.#onPointerUp)
    document.removeEventListener('keydown', this.#onKeyDown)
    document.removeEventListener('keyup', this.#onKeyUp)
    window.removeEventListener('blur', this.#onBlur)

    this.#cancel()

    this.#drone = null
    this.#canvas = null
    this.#container = null
    this.#renderer = null
    this.#getMeshOffset = null
    this.#enabled = false
  }

  // ── pointer events ────────────────────────────────────────

  #onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return
    if (e.button !== 0) return
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    if (this.#spaceHeld) return
    if (!this.#canvas) return
    if (this.#isInteractiveTarget(e.target)) return

    const rect = this.#canvas.getBoundingClientRect()
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    console.log('[desktop-move] pointerdown', { axial, moveActive: this.#drone?.moveActive, hasDrone: !!this.#drone })
    if (!axial) return

    this.#downPos = { x: e.clientX, y: e.clientY }
    this.#downAxial = axial
    this.#dragging = false
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#downPos || !this.#downAxial || !this.#drone) return
    if (e.pointerType === 'touch') return

    const dx = e.clientX - this.#downPos.x
    const dy = e.clientY - this.#downPos.y

    if (!this.#dragging) {
      if (Math.abs(dx) < this.#threshold && Math.abs(dy) < this.#threshold) return

      // threshold exceeded — try to begin move
      const ok = this.#drone.beginMove(this.#downAxial, this.#source)
      if (!ok) {
        this.#downPos = null
        this.#downAxial = null
        return
      }
      this.#dragging = true
      this.#setCursor('grabbing')
    }

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (axial) {
      this.#drone.updateMove(axial, this.#source)
      this.#updateDwell(axial)
    }
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (!this.#downPos) return
    if (e.pointerType === 'touch') return

    if (this.#dragging && this.#drone) {
      const axial = this.#clientToAxial(e.clientX, e.clientY)
      if (axial) {
        void this.#drone.commitMoveAt(axial, this.#source)
      } else {
        this.#drone.cancelMove(this.#source)
      }
    }

    this.#resetDrag()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.#spaceHeld = true
    if (e.key === 'Control') {
      this.#ctrlHeld = true
      // if already dragging, re-evaluate dwell at current position
    }
    if (e.key === 'Escape' && this.#dragging) {
      this.#drone?.cancelMove(this.#source)
      this.#resetDrag()
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.#spaceHeld = false
    if (e.key === 'Control') {
      this.#ctrlHeld = false
      // cancel any active dwell when Ctrl is released
      if (this.#drone?.isDwelling) {
        this.#drone.cancelDwell()
        this.#lastDwellLabel = null
      }
    }
  }

  #onBlur = (): void => {
    if (this.#dragging) {
      this.#drone?.cancelMove(this.#source)
    }
    this.#resetDrag()
    this.#spaceHeld = false
    this.#ctrlHeld = false
    this.#lastDwellLabel = null
  }

  // ── helpers ───────────────────────────────────────────────

  #cancel(): void {
    if (this.#dragging) this.#drone?.cancelMove(this.#source)
    this.#resetDrag()
  }

  #resetDrag(): void {
    this.#downPos = null
    this.#downAxial = null
    this.#dragging = false
    this.#lastDwellLabel = null
    this.#setCursor('')
  }

  #updateDwell(axial: { q: number; r: number }): void {
    if (!this.#drone || !this.#dragging) return

    if (!this.#ctrlHeld) {
      if (this.#lastDwellLabel) {
        this.#drone.cancelDwell()
        this.#lastDwellLabel = null
      }
      return
    }

    // Ctrl held — resolve label at this axial position via MoveDrone
    const hoverLabel = this.#drone.labelAtAxial(axial)

    if (!hoverLabel || !this.#drone.branchLabels.has(hoverLabel)) {
      if (this.#lastDwellLabel) {
        this.#drone.cancelDwell()
        this.#lastDwellLabel = null
      }
      return
    }

    // hovering on a branch tile with Ctrl held
    if (this.#lastDwellLabel !== hoverLabel) {
      this.#lastDwellLabel = hoverLabel
      this.#drone.startDwell(hoverLabel)
    }
  }

  #clientToAxial(cx: number, cy: number): Axial | null {
    if (!this.#container || !this.#renderer || !this.#getMeshOffset) return null

    const detector = window.ioc.get<{ pixelToAxial(px: number, py: number): Axial }>(
      '@diamondcoreprocessor.com/HexDetector'
    )
    if (!detector) return null

    const pixiGlobal = this.#clientToPixiGlobal(cx, cy)
    const local = this.#container.toLocal(pixiGlobal)
    const offset = this.#getMeshOffset()
    return detector.pixelToAxial(local.x - offset.x, local.y - offset.y)
  }

  #clientToPixiGlobal(cx: number, cy: number) {
    const events = this.#renderer?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas!.getBoundingClientRect()
    const screen = this.#renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }

  #setCursor(cursor: string): void {
    if (this.#canvas) this.#canvas.style.cursor = cursor
  }

  #isInsideRect(x: number, y: number, rect: DOMRect): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  #isInteractiveTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false
    return !!target.closest('input, textarea, button, select, option, a, [contenteditable="true"], [contenteditable=""], [role="textbox"]')
  }
}

window.ioc.register('@diamondcoreprocessor.com/DesktopMoveInput', new DesktopMoveInput())
