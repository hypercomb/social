import { Injectable, signal, inject, effect } from "@angular/core"
import { Point } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { LinkNavigationService } from "src/app/navigation/link-navigation-service"
import { PointerState } from "src/app/state/input/pointer-state"
import { EventDispatcher } from "../helper/events/event-dispatcher"
import { LayoutManager } from "../core/controller/layout-manager"
import { KeyboardService } from "../interactivity/keyboard/keyboard-service"
import { SELECTIONS } from "../shared/tokens/i-selection.token"

@Injectable()
export abstract class PanningServiceBase extends PixiDataServiceBase {
  protected readonly keyboard = inject(KeyboardService)
  protected readonly ps = inject(PointerState)
  protected readonly events = inject(EventDispatcher)
  protected readonly manager = inject(LayoutManager)
  protected readonly navigation = inject(LinkNavigationService)
  protected readonly selections = inject(SELECTIONS)

  protected readonly enabled = signal(true)
  public readonly isEnabled = this.enabled.asReadonly()

  protected readonly _cancelled = signal(false)
  public readonly cancelled = this._cancelled.asReadonly()

  protected anchored = false
  protected dragThresholdReached = false
  protected readonly PAN_THRESHOLD = 6

  protected readonly _active = signal(false)
  public readonly active = this._active.asReadonly()
  protected setActive = (v: boolean): void => this._active.set(v)

  // shared anchor state
  private anchorVecX = 0
  private anchorVecY = 0
  private startPosX = 0
  private startPosY = 0
  private downScreenX = 0
  private downScreenY = 0

  constructor() {
    super()

    // establish anchor when subclass says "start"
    effect(() => {
      if (this.ps.downSeq() === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down) return
      if (!this.shouldStart(down)) return

      const container = this.pixi.container
      const app = this.pixi.app
      if (!container || !app) return
      const parent = container.parent ?? container

      const downGlobal = this.domToGlobal(down)
      const centerGlobal = this.canvasCenterGlobal()
      const pointerLocal = parent.worldTransform.applyInverse(downGlobal, new Point())
      const centerLocal = parent.worldTransform.applyInverse(centerGlobal, new Point())

      this.anchorVecX = pointerLocal.x - centerLocal.x
      this.anchorVecY = pointerLocal.y - centerLocal.y
      this.startPosX = container.position.x
      this.startPosY = container.position.y
      this.downScreenX = down.clientX
      this.downScreenY = down.clientY

      this.dragThresholdReached = false
      this.anchored = true
      this.setActive(true)
    })

    // pan while subclass says moves are relevant
    effect(() => {
      if (!this.enabled()) return
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.anchored) return
      if (!this.isMoveRelevant(move)) return
      if (this.manager.locked()) return

      const threshold = this.getPanThreshold()
      if (!this.dragThresholdReached) {
        if (threshold > 0) {
          const dx = move.clientX - this.downScreenX
          const dy = move.clientY - this.downScreenY
          if (Math.hypot(dx, dy) < threshold) return
        }
        this.dragThresholdReached = true
      }

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
      const nextX = this.startPosX + (currVecX - this.anchorVecX)
      const nextY = this.startPosY + (currVecY - this.anchorVecY)
      container.position.set(nextX, nextY)
    })

    // end on up/cancel
    effect(() => {
      if (this.ps.upSeq() === 0 && this.ps.cancelSeq() === 0) return
      if (!this.anchored) return
      this.saveTransform()
      this.clearAnchor()
    })
  }

  public enable = (): void => this.enabled.set(true)
  public disable = (): void => {
    this.enabled.set(false)
    this.navigation.setResetTimeout()
  }

  protected domToGlobal(e: PointerEvent): Point {
    const app = this.pixi.app!
    const view = app.canvas as HTMLCanvasElement
    const rect = view.getBoundingClientRect()
    const x = (e.clientX - rect.left) * app.renderer.resolution
    const y = (e.clientY - rect.top) * app.renderer.resolution
    return new Point(x, y)
  }

  protected canvasCenterGlobal(): Point {
    const app = this.pixi.app!
    const view = app.canvas as HTMLCanvasElement
    return new Point(view.width * 0.5, view.height * 0.5)
  }

  protected clearAnchor(): void {
    this.anchored = false
    this._cancelled.set(false)
    this.dragThresholdReached = false
    this.setActive(false)
  }

  protected safeInit(): void {
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
  }

  protected override onPixiReady(): void {
    this.safeInit()
  }

  // subclass hooks
  protected abstract shouldStart(down: PointerEvent): boolean
  protected abstract isMoveRelevant(move: PointerEvent): boolean
  protected getPanThreshold(): number { return this.PAN_THRESHOLD }
}
