import { Injectable, computed, effect, inject, signal } from "@angular/core"
import { Point } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { LinkNavigationService } from "src/app/navigation/link-navigation-service"
import { PointerState } from "src/app/state/input/pointer-state"
import { EventDispatcher } from "../helper/events/event-dispatcher"
import { LayoutManager } from "../core/controller/layout-manager"
import { KeyboardService } from "../interactivity/keyboard/keyboard-service"
import { SELECTIONS } from "../shared/tokens/i-selection.token"

@Injectable({ providedIn: "root" })
export class TouchPanningService extends PixiDataServiceBase {
  private readonly keyboard = inject(KeyboardService)
  private readonly ps = inject(PointerState)
  private readonly events = inject(EventDispatcher)
  private readonly manager = inject(LayoutManager)
  private readonly navigation = inject(LinkNavigationService)
  private readonly selections = inject(SELECTIONS)
  private initialized = false
  private anchored = false
  private crossed = false

  private anchorVecX = 0
  private anchorVecY = 0
  private startPosX = 0
  private startPosY = 0
  private capturedPointerId: number | null = null

  private readonly enabled = signal(true)
  private readonly _cancelled = signal(false)
  public readonly cancelled = this._cancelled.asReadonly()

  private readonly focused = (() => {
    const s = signal<boolean>(document.hasFocus())
    const on = () => s.set(true)
    const off = () => s.set(false)
    window.addEventListener("focus", on)
    window.addEventListener("blur", off)
    return s.asReadonly()
  })()

  private suspendUntilUp = signal(false)

  private readonly isTouchPan = computed(() => {
    const down = this.ps.pointerDownEvent()
    return !!down && down.pointerType === "touch"
  })

  public readonly canPan = computed(() => {
    const over = this.ps.dragOver() || (this.isTouchPan() && this.ps.activePointers().size > 0)

    if (this.isTouchPan()) {
      return this.enabled()
        && this.focused()
        && !this.suspendUntilUp()
        && over
        && this.ps.activePointers().size === 1
        && !this.manager.locked()
    }

    return this.enabled()
      && this.focused()
      && !this.suspendUntilUp()
      && this.ps.dragOver()
      && this.keyboard.spaceDown()
      && !this.selections.canSelect()
      && !this.manager.locked()
  })

  constructor() {
    super()

    // suspend on blur
    window.addEventListener("blur", () => {
      this.anchored = false
      this.suspendUntilUp.set(true)
      const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
      if (this.capturedPointerId != null && canvas?.releasePointerCapture) {
        try { canvas.releasePointerCapture(this.capturedPointerId) } catch { }
        this.capturedPointerId = null
      }
    })

    // unsuspend on next pointer up
    effect(() => {
      if (this.ps.upSeq() === 0) return
      if (!this.focused()) return
      if (!this.suspendUntilUp()) return
      this.suspendUntilUp.set(false)
    })

    // reset anchor when spacebar released
    effect(() => {
      if (!this.keyboard.spaceDown()) this.clearAnchor()
    })

    // 🔹 pointer down → set anchor immediately
    effect(() => {
      if (this.ps.downSeq() === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || !this.canPan()) return

      const container = this.pixi.container
      const app = this.pixi.app
      if (!container || !app) return
      const parent = container.parent ?? container

      const downGlobal = this.domToGlobal(down)
      const centerGlobal = this.canvasCenterGlobal()

      const pointerLocal = parent.worldTransform.applyInverse(downGlobal, new Point())
      const centerLocal = parent.worldTransform.applyInverse(centerGlobal, new Point())

      // capture anchor + start position at the exact down point
      this.anchorVecX = pointerLocal.x - centerLocal.x
      this.anchorVecY = pointerLocal.y - centerLocal.y
      this.startPosX = container.position.x
      this.startPosY = container.position.y
      this.crossed = false
      this._cancelled.set(false)
      this.navigation.cancelled = false
      this.anchored = true

      // take dom pointer capture so moves don't get lost
      try {
        const canvas = app.canvas as HTMLCanvasElement
        if (down.pointerId != null && canvas?.setPointerCapture) {
          canvas.setPointerCapture(down.pointerId)
          this.capturedPointerId = down.pointerId
        }
        down.preventDefault?.()
      } catch { }
    })

    // pointer move → apply delta
    effect(() => {
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.canPan()) return
      if (move.pointerType === "touch" && this.ps.activePointers().size !== 1) return
      if (!this.anchored) return

      const container = this.pixi.container
      const app = this.pixi.app
      if (!container || !app) return

      const parent = container.parent ?? container
      const currGlobal = this.domToGlobal(move)
      const centerGlobal = this.canvasCenterGlobal()

      const pointerLocal = parent.worldTransform.applyInverse(currGlobal, new Point())
      const centerLocal = parent.worldTransform.applyInverse(centerGlobal, new Point())

      const currVecX = pointerLocal.x - centerLocal.x
      const currVecY = pointerLocal.y - centerLocal.y

      const dX = currVecX - this.anchorVecX
      const dY = currVecY - this.anchorVecY

      // compute next position directly in parent-local space (no double scale)
      const nextX = this.startPosX + dX
      const nextY = this.startPosY + dY

      // threshold check
      if (!this.crossed) {
        const t = this.settings.panThreshold
        if (Math.abs(nextX - this.startPosX) > t || Math.abs(nextY - this.startPosY) > t) {
          this.crossed = true
          this._cancelled.set(true)
          this.navigation.cancelled = true
          this.events.panningThresholdAttained()
        }
      }

      container.position.set(nextX, nextY)

      const entry = this.stack.top()
      const cell = entry?.cell
      if (cell) {
        cell.x = nextX
        cell.y = nextY
      }
    })

    // end of pan
    effect(() => {
      const space = this.keyboard.spaceDown()
      const up = this.ps.upSeq()
      const cancel = this.ps.cancelSeq()
      if (!this.anchored) return

      const shouldEnd = (!space && !this.isTouchPan()) || (up > 0 || cancel > 0)
      if (!shouldEnd) return

      this.navigation.setResetTimeout()
      this.saveTransform()

      // release dom pointer capture if held
      const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
      if (this.capturedPointerId != null && canvas?.releasePointerCapture) {
        try { canvas.releasePointerCapture(this.capturedPointerId) } catch { }
        this.capturedPointerId = null
      }

      this.clearAnchor()
    })
  }

  protected override onPixiReady(): void {
    this.safeInit()
  }

  private safeInit(): void {
    const container = this.pixi.container
    if (!container) {
      this.debug.log?.("warning", "panning: no container yet")
      return
    }
    container.eventMode = "static"
    container.hitArea ??= { contains: () => true }

    const canvas = this.pixi.app?.canvas as HTMLCanvasElement
    canvas.style.touchAction = "none"
    canvas.style.userSelect = "none"

      ; (container as any).style ??= {}
      ; (container as any).style.touchAction = "none"
  }

  private domToGlobal(e: PointerEvent): Point {
    const app = this.pixi.app!
    const view = app.canvas as HTMLCanvasElement
    const rect = view.getBoundingClientRect()
    const x = (e.clientX - rect.left) * app.renderer.resolution
    const y = (e.clientY - rect.top) * app.renderer.resolution
    return new Point(x, y)
  }

  private canvasCenterGlobal(): Point {
    const app = this.pixi.app!
    const view = app.canvas as HTMLCanvasElement
    return new Point(view.width * 0.5, view.height * 0.5)
  }

  private clearAnchor() {
    setTimeout(() => this.initialized = true, 50)
    if (!this.initialized) return

    this.anchored = false
    this.crossed = false
    this._cancelled.set(false)

    if (!this.pixi.app?.canvas) return

    const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined

    if (this.capturedPointerId != null && canvas?.releasePointerCapture) {
      try { canvas.releasePointerCapture(this.capturedPointerId) } catch { }
      this.capturedPointerId = null
    }
  }

  public enable = (): void => this.enabled.set(true)
  public disable = (): void => {
    this.enabled.set(false)
    this.navigation.setResetTimeout()
  }
}
