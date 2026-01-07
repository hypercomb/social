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

  protected usePanThreshold = true
  private scrollBlocker: (() => void) | null = null

  // new: lock pan to a single pointer
  protected activePointerId: number | null = null

  constructor() {
    super()

    // new pointerdown gesture clears cancelled flag
    effect(() => {
      const downSeq = this.ps.downSeq()
      if (downSeq === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down) return
      if (down.button !== 0) return
      this._cancelled.set(false)
      this.state.setCancelled(false)
    })

    // anchor when pointer is pressed (for services that opt in)
    effect(() => {
      if (!this.anchorOnDown) return
      if (this.ps.downSeq() === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || !this.shouldStart(down)) return
      if (this.anchored) return // do not reanchor mid gesture

      this.startAnchorAt(down.clientX, down.clientY, down.pointerId)
    })

    // handle move events
    effect(() => {
      if (!this.enabled()) return
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.anchored) return
      if (!this.isMoveRelevant(move)) return
      if (this.manager.locked()) return

      // ignore moves from any pointer except the one we anchored with
      if (this.activePointerId !== null && move.pointerId !== this.activePointerId) return

      // threshold detection
      if (this.usePanThreshold && !this.dragThresholdReached) {
        const threshold = this.getPanThreshold()
        if (threshold > 0) {
          const dx = move.clientX - this.downScreenX
          const dy = move.clientY - this.downScreenY
          if (Math.hypot(dx, dy) < threshold) return
        }

        // reanchor at the frame where drag actually starts to avoid first frame jump
        const container = this.pixi.container
        if (container) {
          this.startPosX = container.position.x
          this.startPosY = container.position.y
          this.downScreenX = move.clientX
          this.downScreenY = move.clientY
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

  protected beginPan(): void {
    if (!this.state.panning) this.state.panning = true
    this._cancelled.set(true)
    this.state.setCancelled(true)
  }

  protected commitTransform(): void {
    const c = this.pixi.container
    const cell = this.stack.top()?.cell

    if (c && cell) {
      cell.x = c.x
      cell.y = c.y
      cell.scale = c.scale.x
      this.debug.log("panning", "commitTransform", { x: cell.x, y: cell.y, scale: cell.scale })
    }

    this.saveTransform()
    this.unblockScroll()

    const drag = this.dragThresholdReached
    this.anchored = false
    this.dragThresholdReached = false
    this.activePointerId = null
    this.setActive(false)
    this.state.panning = false

    if (!drag) {
      this._cancelled.set(false)
      this.state.setCancelled(false)
    }
  }

  protected blockScroll(): void {
    if (this.scrollBlocker) return
    const body = document.body
    const prev = body.style.overflow
    body.style.overflow = "hidden"
    this.scrollBlocker = () => {
      body.style.overflow = prev
      this.scrollBlocker = null
    }
  }

  public cancelPanSession(): void {
    this.unblockScroll()
    this.anchored = false
    this.dragThresholdReached = false
    this.activePointerId = null
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
    const c = this.pixi.container
    if (!c) return
    c.eventMode = "static"
    c.hitArea ??= { contains: () => true }
  }

  protected override onPixiReady(): void {
    this.safeInit()
  }

  // new: optional pointer id so we lock to that pointer
  protected startAnchorAt(x: number, y: number, pointerId?: number): void {
    const c = this.pixi.container
    const app = this.pixi.app
    if (!c || !app) return

    this.startPosX = c.position.x
    this.startPosY = c.position.y
    this.downScreenX = x
    this.downScreenY = y
    this.dragThresholdReached = false
    this.anchored = true
    this.activePointerId = pointerId ?? null
    this.setActive(true)
    this.blockScroll()
  }

  protected performPan(move: PointerEvent): void {
    const c = this.pixi.container
    const app = this.pixi.app
    if (!c || !app) return
    const r = app.renderer.resolution
    const dx = (move.clientX - this.downScreenX) * r
    const dy = (move.clientY - this.downScreenY) * r
    c.position.set(this.startPosX + dx, this.startPosY + dy)
  }

  private unblockScroll(): void {
    if (this.scrollBlocker) {
      this.scrollBlocker()
      this.scrollBlocker = null
    }
  }

  protected abstract shouldStart(down: PointerEvent): boolean
  protected abstract isMoveRelevant(move: PointerEvent): boolean
  protected getPanThreshold(): number { return this.PAN_THRESHOLD }
}
