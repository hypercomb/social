// diamondcoreprocessor.com/input/pan/spacebar-pan.input.ts
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
  // Updated by mousemove. We use this at keydown time to decide whether
  // the user is targeting the canvas (so spacebar should pan, not type
  // a space into whatever has focus).
  private mouseOverCanvas = false

  private readonly source = 'spacebar-pan'

  private pan: {
    panBy: (delta: Point) => void
  } | null = null

  // Lazy gate resolution: InputGate may be in a different bee (zoom.drone)
  // that hasn't loaded yet at the moment we attach. Caching a null
  // reference here meant onMove's `gate?.claim()` returned undefined,
  // !undefined was truthy, and the handler bailed before setting `last`
  // — pan looked totally dead even though spaceHeld and mouseOverCanvas
  // were both true. Resolve every call so we pick the gate up the
  // instant zoom bee finishes loading.
  private get gate(): InputGate | null {
    return window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate') ?? null
  }

  public attach = (
    pan: {
      panBy: (delta: Point) => void
    },
    canvas: HTMLCanvasElement
  ): void => {
    if (this.enabled) return

    this.pan = pan
    this.canvas = canvas

    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMove)
    // Track cursor position via mousemove on document — mouseenter alone
    // misses the case where the cursor was already over the canvas when
    // attach() ran (extremely common: pixi creates the canvas after page
    // load, cursor is often already pointing at the area). The dedicated
    // tracker fires on every mousemove regardless of whether spaceHeld
    // is set, so the flag is always accurate by the time the user
    // presses space.
    document.addEventListener('mousemove', this.onTrackCursor)
    canvas.addEventListener('mouseenter', this.onCanvasEnter)
    canvas.addEventListener('mouseleave', this.onCanvasLeave)
    window.addEventListener('blur', this.onBlur)

    this.enabled = true
  }

  public detach = (): void => {
    if (!this.enabled) return

    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMove)
    document.removeEventListener('mousemove', this.onTrackCursor)
    if (this.canvas) {
      this.canvas.removeEventListener('mouseenter', this.onCanvasEnter)
      this.canvas.removeEventListener('mouseleave', this.onCanvasLeave)
    }
    window.removeEventListener('blur', this.onBlur)

    this.endPan()

    this.pan = null
    this.canvas = null
    this.enabled = false
    this.mouseOverCanvas = false
  }

  // -------------------------------------------------
  // keyboard
  // -------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== ' ') return
    if (e.repeat) return

    // Pan when the cursor is over the canvas, regardless of where the
    // browser focus currently is. The command-line auto-focuses on many
    // boot/nav paths, so the previous "bail if focus is in any input"
    // check made spacebar pan look broken on every other refresh — user
    // saw "sometimes works, sometimes not" depending on whether focus
    // had migrated yet. Cursor-over-canvas is the right signal: it
    // tracks user intent (they're pointing at the grid, they want to
    // pan it). Focus-elsewhere typing still works because we only
    // intercept when cursor is over the canvas.
    if (!this.mouseOverCanvas) {
      // Cursor isn't over the canvas — let the space key behave normally
      // (type into inputs, scroll page, whatever).
      return
    }

    // prevent page scroll AND prevent the focused element from receiving the space
    e.preventDefault()

    this.spaceHeld = true
    this.setCursor('grab')
  }

  private onCanvasEnter = (): void => {
    this.mouseOverCanvas = true
  }

  private onCanvasLeave = (): void => {
    this.mouseOverCanvas = false
    // If user releases the cursor from the canvas mid-pan, end the pan
    // gesture so we don't accumulate pan deltas across an off-canvas
    // re-entry.
    if (this.spaceHeld) this.endPan()
  }

  // Always-on cursor tracker — keeps mouseOverCanvas in sync regardless
  // of whether the user has triggered mouseenter/leave yet (those don't
  // fire if the cursor was already inside the canvas at attach time).
  private onTrackCursor = (e: MouseEvent): void => {
    if (!this.canvas) return
    const rect = this.canvas.getBoundingClientRect()
    const inside = this.isInsideRect(e.clientX, e.clientY, rect)
    if (inside !== this.mouseOverCanvas) {
      this.mouseOverCanvas = inside
      if (!inside && this.spaceHeld) this.endPan()
    }
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
}
