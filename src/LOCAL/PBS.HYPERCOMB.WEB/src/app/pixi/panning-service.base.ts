// src/app/pixi/panning-service.base.ts (Fixed: add resolution effect, flip drag direction sign)
import { Injectable, signal, inject, effect } from "@angular/core"
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

  protected anchorOnDown = false
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

  // shared anchor state (robustified to screen-space deltas)
  protected startPosX = 0
  protected startPosY = 0
  protected downScreenX = 0
  protected downScreenY = 0

  // Scroll blocking
  private scrollBlocker: (() => void) | null = null

  constructor() {
    super()


    effect(() => {
      if (!this.anchorOnDown) return
      if (this.ps.downSeq() === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || !this.shouldStart(down)) return
      this.startAnchorAt(down.clientX, down.clientY)
    })

    // pan while subclass says moves are relevant
    // In PanningServiceBase, replace the big effect with:
    effect(() => {
      if (!this.enabled()) return
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.anchored) return
      if (!this.isMoveRelevant(move)) return
      if (this.manager.locked()) return

      const threshold = this.getPanThreshold()
      if (!this.dragThresholdReached && threshold > 0) {
        const dx = move.clientX - this.downScreenX
        const dy = move.clientY - this.downScreenY
        if (Math.hypot(dx, dy) < threshold) return
        this.dragThresholdReached = true
      }

      this.performPan(move)  // Now shared
    })

    // end on up/cancel
    effect(() => {
      if (this.ps.upSeq() === 0 && this.ps.cancelSeq() === 0) return
      if (!this.anchored) return
      this.saveTransform()
      this.unblockScroll()
      this.clearAnchor()
    })
  }

  public enable = (): void => this.enabled.set(true)
  public disable = (): void => {
    this.enabled.set(false)
    this.navigation.setResetTimeout()
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

  // Scroll blocking methods
  protected blockScroll(): void {
    if (this.scrollBlocker) return
    const body = document.body
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    this.scrollBlocker = () => {
      body.style.overflow = prevOverflow
      this.scrollBlocker = null
    }
  }

  // in panning-service.base.ts
  protected startAnchorAt(x: number, y: number): void {
    const container = this.pixi.container
    const app = this.pixi.app
    if (!container || !app) return

    this.startPosX = container.position.x
    this.startPosY = container.position.y
    this.downScreenX = x
    this.downScreenY = y

    this.dragThresholdReached = false
    this.anchored = true
    this.setActive(true)
    this.blockScroll()
  }

  protected performPan(move: PointerEvent): void {
    const container = this.pixi.container
    const app = this.pixi.app
    if (!container || !app) return

    const resolution = app.renderer.resolution
    const dx = (move.clientX - this.downScreenX) * resolution
    const dy = (move.clientY - this.downScreenY) * resolution
    const nextX = this.startPosX + dx
    const nextY = this.startPosY + dy
    container.position.set(nextX, nextY)
  }

  private unblockScroll(): void {
    if (this.scrollBlocker) {
      this.scrollBlocker()
      this.scrollBlocker = null
    }
  }

  // subclass hooks
  protected abstract shouldStart(down: PointerEvent): boolean
  protected abstract isMoveRelevant(move: PointerEvent): boolean
  protected getPanThreshold(): number { return this.PAN_THRESHOLD }
} 