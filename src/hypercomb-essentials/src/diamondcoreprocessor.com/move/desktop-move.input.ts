// diamondcoreprocessor.com/input/move/desktop-move.input.ts
import { Point } from 'pixi.js'
import { EffectBus } from '@hypercomb/core'
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
  #lastAxial: Axial | null = null
  #dragging = false
  #spaceHeld = false
  #ctrlHeld = false
  // Ctrl/Meta held at the moment the drag is grabbed → COPY this drag (vs
  // drop-into, which is Ctrl pressed AFTER the drag begins). Captured at
  // pointerdown so a release before drop still commits the copy the user started.
  #copyAtBegin = false

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
    if (e.shiftKey || e.altKey) return
    if (this.#spaceHeld) return
    if (!this.#canvas) return
    if (this.#isInteractiveTarget(e.target)) return

    const rect = this.#canvas.getBoundingClientRect()
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (!axial) return

    // Move engages ONLY on an already-selected tile — select first (Ctrl-click),
    // then drag to move. A press on an UNSELECTED tile is left to the selection
    // drone so Ctrl-click-to-select is never hijacked by the drag. (One-gesture
    // grab-and-drag of an unselected tile was reverted: on a trackpad the jitter
    // in a Ctrl-CLICK crossed the drag threshold, fired move:drag-end, and
    // suppressed the tile:click — breaking selection entirely.)
    const label = this.#drone?.labelAtAxial(axial) ?? null
    if (!label) return
    const selection = window.ioc.get<{ selected: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')
    if (!selection?.selected.has(label)) return

    // Ctrl-drag COPY is disabled for now. A copy would mint a same-content tile
    // with an auto-generated "<label> copy" name — but in Hypercomb the NAME is
    // the immutable identity, so a duplicate is only meaningful if you choose the
    // new name UP FRONT (drop the tile's icon into the command line like an image
    // drop and type the name). Until that flow exists a drag only ever moves, and
    // Ctrl now always means drop-into. Restore `= e.ctrlKey || e.metaKey` to bring
    // copy-on-drag back once the named-duplicate flow lands.
    this.#copyAtBegin = false

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
      // Seed drop-into from the LIVE modifier on the pointer event at the grab —
      // NOT the keydown-tracked #ctrlHeld, which can lag a one-gesture Cmd-grab
      // (the key event may not have registered before the drag threshold), so a
      // grab-and-drag of an unselected tile would wrongly REORDER (leaving the
      // tile at the dragged slot) instead of dropping it into the target.
      this.#ctrlHeld = e.ctrlKey || e.metaKey
      if (this.#ctrlHeld) this.#drone.setDropIntoActive(true)
    }

    // Keep drop-into synced to the live modifier on every move — robust to a
    // press/release mid-drag and to a missed keydown/keyup (Mac's Cmd keyup is
    // flaky). Idempotent with the keydown/keyup handlers.
    const mod = e.ctrlKey || e.metaKey
    if (mod !== this.#ctrlHeld) {
      this.#ctrlHeld = mod
      this.#drone.setDropIntoActive(mod)
    }

    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (axial) {
      this.#lastAxial = axial
      this.#drone.updateMove(axial, this.#source)
    }
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (!this.#downPos) return
    if (e.pointerType === 'touch') return

    if (this.#dragging && this.#drone) {
      // A real drag happened — suppress the trailing native click so it can't
      // re-toggle the source tile's selection (the click fires after this).
      EffectBus.emit('move:drag-end', {})
      const axial = this.#clientToAxial(e.clientX, e.clientY) ?? this.#lastAxial
      if (axial) {
        // Decide drop-into vs reorder from the LIVE modifier at release — robust
        // to a missed key event on a one-gesture Cmd-grab.
        if (e.ctrlKey || e.metaKey) {
          void this.#drone.commitDropInto(axial, this.#source)
        } else {
          void this.#drone.commitMoveAt(axial, this.#source)
        }
      } else {
        this.#drone.cancelMove(this.#source)
      }
    }

    this.#resetDrag()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.#spaceHeld = true
    // Ctrl (Windows/Linux) OR Cmd/Meta (Mac) is the drop-into modifier — Jaime
    // works on Mac and says "cmd drag", so Meta must arm drop-into the same way.
    if (e.key === 'Control' || e.key === 'Meta') {
      if (!this.#ctrlHeld) {
        this.#ctrlHeld = true
        // mid-drag: flip the drone into drop-into preview mode — but NOT when
        // this drag was grabbed as a copy (copy was latched at the grab).
        if (this.#dragging && this.#drone && !this.#copyAtBegin) {
          this.#drone.setDropIntoActive(true)
        }
      }
    }
    if (e.key === 'Escape' && this.#dragging) {
      this.#drone?.cancelMove(this.#source)
      this.#resetDrag()
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.#spaceHeld = false
    if (e.key === 'Control' || e.key === 'Meta') {
      if (this.#ctrlHeld) {
        this.#ctrlHeld = false
        // mid-drag: revert to normal swap preview
        if (this.#dragging && this.#drone) {
          this.#drone.setDropIntoActive(false)
        }
      }
    }
  }

  #onBlur = (): void => {
    if (this.#dragging) {
      this.#drone?.cancelMove(this.#source)
    }
    this.#resetDrag()
    this.#spaceHeld = false
    if (this.#ctrlHeld && this.#drone) this.#drone.setDropIntoActive(false)
    this.#ctrlHeld = false
  }

  // ── helpers ───────────────────────────────────────────────

  #cancel(): void {
    if (this.#dragging) this.#drone?.cancelMove(this.#source)
    this.#resetDrag()
  }

  #resetDrag(): void {
    this.#downPos = null
    this.#downAxial = null
    this.#lastAxial = null
    this.#dragging = false
    this.#copyAtBegin = false
    this.#setCursor('')
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
