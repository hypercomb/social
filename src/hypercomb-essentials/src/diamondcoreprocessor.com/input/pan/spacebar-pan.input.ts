// hypercomb-essentials/src/diamondcoreprocessor.com/input/pan/spacebar-pan.input.ts

import type { InputGate } from '../input-gate.service.js'

type Point = { x: number; y: number }

/**
 * Hold spacebar to pan — no click required. Move the mouse while
 * spacebar is held and the stage follows. Releasing spacebar ends the pan.
 *
 * Skips activation when focus is inside an interactive element so that
 * typing a space in an input/textarea works normally.
 */
export class SpacebarPanInput {
  private enabled = false
  private spaceHeld = false
  private last: Point | null = null
  private canvas: HTMLCanvasElement | null = null

  private readonly source = 'spacebar-pan'

  private pan: {
    panBy: (delta: Point) => void
  } | null = null

  private gate: InputGate | null = null

  public attach = (
    pan: {
      panBy: (delta: Point) => void
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.pan = pan
    this.canvas = canvas
    this.gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null

    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMove)
    window.addEventListener('blur', this.onBlur)

    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMove)
    window.removeEventListener('blur', this.onBlur)

    this.endPan()

    this.pan = null
    this.canvas = null
    this.gate = null
    this.enabled = false
  }

  // -------------------------------------------------
  // keyboard
  // -------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== ' ') return
    if (e.repeat) return
    if (this.isInteractiveFocus()) return

    // prevent page scroll
    e.preventDefault()

    this.spaceHeld = true
    this.setCursor('grab')
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== ' ') return

    this.endPan()
  }

  private onBlur = (): void => {
    this.endPan()
  }

  // -------------------------------------------------
  // mouse movement
  // -------------------------------------------------

  private onMove = (e: MouseEvent): void => {
    if (!this.spaceHeld || !this.pan || !this.canvas) return

    const rect = this.canvas.getBoundingClientRect()
    if (!this.isInsideRect(e.clientX, e.clientY, rect)) return

    if (!this.last) {
      // first move after spacebar pressed — anchor
      if (!this.gate?.claim(this.source)) return
      this.last = { x: e.clientX, y: e.clientY }
      this.setCursor('grabbing')
      return
    }

    const next = { x: e.clientX, y: e.clientY }
    const delta = { x: next.x - this.last.x, y: next.y - this.last.y }
    this.last = next

    this.pan.panBy(delta)
  }

  // -------------------------------------------------
  // cleanup
  // -------------------------------------------------

  private endPan = (): void => {
    if (this.spaceHeld && this.last) {
      this.gate?.release(this.source)
    }
    this.spaceHeld = false
    this.last = null
    this.setCursor('')
  }

  // -------------------------------------------------
  // cursor
  // -------------------------------------------------

  private setCursor = (cursor: string): void => {
    if (!this.canvas) return
    this.canvas.style.cursor = cursor
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private isInsideRect = (x: number, y: number, rect: DOMRect): boolean => {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  private isInteractiveFocus = (): boolean => {
    const el = document.activeElement
    if (!el) return false
    return !!el.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'
    )
  }
}
