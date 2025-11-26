// src/app/pixi/panning-service.base.ts
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

  protected startPosX = 0
  protected startPosY = 0
  protected downScreenX = 0
  protected downScreenY = 0

  /** determines if drag threshold suppression should apply */
  protected usePanThreshold = true

  private scrollBlocker: (() => void) | null = null

  constructor() {
    super()

    // 🔹 New primary pointerdown = new gesture → clear previous cancellation
    effect(() => {
      const downSeq = this.ps.downSeq()
      if (downSeq === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down) return
      if (down.button !== 0) return // only left / primary

      this._cancelled.set(false)
      this.state.setCancelled(false)
      // do NOT touch state.panning here; that is set only when we actually pan
    })

    // anchor when pointer is pressed (for services that opt-in)
    effect(() => {
      if (!this.anchorOnDown) return
      if (this.ps.downSeq() === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || !this.shouldStart(down)) return
      this.startAnchorAt(down.clientX, down.clientY)
    })

    // handle move events
    effect(() => {
      if (!this.enabled()) return
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.anchored) return
      if (!this.isMoveRelevant(move)) return
      if (this.manager.locked()) return

      // threshold → decide when it becomes a pan
      if (this.usePanThreshold && !this.dragThresholdReached) {
        const threshold = this.getPanThreshold()
        if (threshold > 0) {
          const dx = move.clientX - this.downScreenX
          const dy = move.clientY - this.downScreenY
          if (Math.hypot(dx, dy) < threshold) return
        }
        this.dragThresholdReached = true
        this.beginPan()
      } else if (!this.usePanThreshold && !this.dragThresholdReached) {
        this.dragThresholdReached = true
        this.beginPan()
      }

      this.performPan(move)
    })

    // save on pointerup or cancel
    effect(() => {
      const upSeq = this.ps.upSeq()
      const cancelSeq = this.ps.cancelSeq()
      if (upSeq === 0 && cancelSeq === 0) return
      if (!this.anchored) return
      this.commitTransform()
    })
  }

  /** called when a pan gesture actually starts (threshold passed) */
  protected beginPan(): void {
    if (!this.state.panning) {
      this.state.panning = true
    }
    // this gesture should not trigger click-based actions
    this._cancelled.set(true)
    this.state.setCancelled(true)
  }

  /** commits transform and updates the cell to remain the source of truth */
  protected commitTransform(): void {
    const container = this.pixi.container
    const cell = this.stack.top()?.cell

    if (container && cell) {
      cell.x = container.x
      cell.y = container.y
      cell.scale = container.scale.x
      this.debug.log("panning", "commitTransform", {
        x: cell.x,
        y: cell.y,
        scale: cell.scale,
      })
    }

    this.saveTransform()
    this.unblockScroll()

    const dragged = this.dragThresholdReached

    this.anchored = false
    this.dragThresholdReached = false
    this.setActive(false)
    this.state.panning = false

    if (!dragged) {
      // no actual pan ⇒ allow click
      this._cancelled.set(false)
      this.state.setCancelled(false)
    }
    // if dragged: keep cancelled=true for this gesture.
    // Next pointerdown will clear it via the effect above.
  }

  protected blockScroll(): void {
    if (this.scrollBlocker) return
    const body = document.body
    const prevOverflow = body.style.overflow
    body.style.overflow = "hidden"
    this.scrollBlocker = () => {
      body.style.overflow = prevOverflow
      this.scrollBlocker = null
    }
  }

  /** Hard reset for navigation/context switches (e.g. Back action). */
  public cancelPanSession(): void {
    this.unblockScroll()
    this.anchored = false
    this.dragThresholdReached = false
    this.setActive(false)

    this._cancelled.set(false)
    this.state.setCancelled(false)
    this.state.panning = false
  }

  public enable = (): void => this.enabled.set(true)

  public disable = (): void => {
    this.enabled.set(false)
    this.navigation.setResetTimeout()
  }

  protected safeInit(): void {
    const container = this.pixi.container
    if (!container) return
    container.eventMode = "static"
    container.hitArea ??= { contains: () => true }
  }

  protected override onPixiReady(): void {
    this.safeInit()
  }

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
    container.position.set(this.startPosX + dx, this.startPosY + dy)
  }

  private unblockScroll(): void {
    if (this.scrollBlocker) {
      this.scrollBlocker()
      this.scrollBlocker = null
    }
  }

  protected abstract shouldStart(down: PointerEvent): boolean
  protected  isMoveRelevant(move: PointerEvent) : boolean {
    return true
  } 
  protected getPanThreshold(): number {
    return this.PAN_THRESHOLD
  }
}
