import { Injectable, computed, effect, inject, signal } from "@angular/core"
import { Point } from "pixi.js"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"
import { LinkNavigationService } from "src/app/navigation/link-navigation-service"
import { PointerState } from "src/app/state/input/pointer-state"
import { EventDispatcher } from "../helper/events/event-dispatcher"
import { LayoutManager } from "../core/controller/layout-manager"
import { KeyboardService } from "../interactivity/keyboard/keyboard-service"
import { SELECTIONS } from "../shared/tokens/i-selection.token"

@Injectable({ providedIn: 'root' })
export class TouchPanningService extends PixiDataServiceBase {
  private readonly keyboard = inject(KeyboardService)
  private readonly ps = inject(PointerState)
  private readonly events = inject(EventDispatcher)
  private readonly manager = inject(LayoutManager)
  private readonly navigation = inject(LinkNavigationService)
  private readonly selections = inject(SELECTIONS)

  // gesture flags
  private anchored = false
  private crossed = false

  // last pointer in renderer global pixels (device px). we always compute deltas from this.
  private lastGlobal: Point | null = null

  // position at anchor (for threshold comparison)
  private startPosX = 0
  private startPosY = 0

  // enable / disable
  private readonly enabled = signal(true)

  // reactive cancel signal (pan abort)
  private readonly _cancelled = signal(false)
  public readonly cancelled = this._cancelled.asReadonly()

  // focus gate
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

    // touch: single finger without space
    if (this.isTouchPan()) {
      return this.enabled()
        && this.focused()
        && !this.suspendUntilUp()
        && over
        && this.ps.activePointers().size === 1
        && !this.manager.locked()
    }

    // mouse / pen: space + no selection
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
    })

    // unsuspend on next pointer up
    effect(() => {
      if (this.ps.upSeq() === 0) return
      if (!this.focused()) return
      if (!this.suspendUntilUp()) return
      this.suspendUntilUp.set(false)
    })

    // reset anchor when space is released
    effect(() => {
      if (!this.keyboard.spaceDown()) this.clearAnchor()
    })

    // pointer move → pan
    effect(() => {
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.canPan()) return

      // avoid pinch while in touch mode
      if (move.pointerType === "touch" && this.ps.activePointers().size !== 1) return

      const container = this.pixi.container
      const app = this.pixi.app
      if (!container || !app) return

      const parent = container.parent ?? container

      // current pointer in renderer global coords (device px)
      const currGlobal = this.domToGlobal(move)

      // first frame of drag: capture anchor
      if (!this.anchored || this.lastGlobal === null) {
        this.lastGlobal = currGlobal.clone()
        this.startPosX = container.position.x
        this.startPosY = container.position.y
        this.crossed = false
        this._cancelled.set(false)
        this.navigation.cancelled = false
        this.anchored = true
        return
      }

      // convert prev and curr global → parent-local, then take local delta
      const prevLocal = parent.worldTransform.applyInverse(this.lastGlobal, new Point())
      const currLocal = parent.worldTransform.applyInverse(currGlobal, new Point())
      const dx = currLocal.x - prevLocal.x
      const dy = currLocal.y - prevLocal.y
      if (dx === 0 && dy === 0) return

      // threshold detection from anchor
      if (!this.crossed) {
        const movedX = (container.position.x + dx) - this.startPosX
        const movedY = (container.position.y + dy) - this.startPosY
        const t = this.settings.panThreshold
        if (Math.abs(movedX) > t || Math.abs(movedY) > t) {
          this.crossed = true
          this._cancelled.set(true)
          this.navigation.cancelled = true
          this.events.panningThresholdAttained()
          this.state.setCancelled(true)
        }
      }

      // apply local delta
      container.position.set(container.position.x + dx, container.position.y + dy)

      // advance last
      this.lastGlobal.copyFrom(currGlobal)

      // persist into current cell, if any
      const entry = this.stack.top()
      const cell = entry?.cell
      if (cell) {
        cell.x = container.position.x
        cell.y = container.position.y
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
      this.clearAnchor()
    })
  }

  protected override onPixiReady(): void {
    this.safeInit()
  }

  private safeInit(): void {
    const container = this.pixi.container
    if (!container) {
      this.debug.log?.('warning', 'panning: no container yet')
      return
    }
    container.eventMode = 'static'
    container.hitArea ??= { contains: () => true }

    const canvas = (this.pixi.app?.canvas as HTMLCanvasElement | undefined)!
    canvas.style.touchAction = 'none'
    canvas.style.userSelect = 'none'

    ;(container as any).style ??= {}
    ;(container as any).style.touchAction = 'none'
  }

  // dom (css px) → renderer global (device px); uses canvas rect, not screen offsets
  private domToGlobal(e: PointerEvent): Point {
    const app = this.pixi.app!
    const view = app.canvas as HTMLCanvasElement
    const rect = view.getBoundingClientRect()
    const x = (e.clientX - rect.left) * app.renderer.resolution
    const y = (e.clientY - rect.top) * app.renderer.resolution
    return new Point(x, y)
  }

  private clearAnchor() {
    this.anchored = false
    this.crossed = false
    this.lastGlobal = null
    this._cancelled.set(false)
  }

  public enable = (): void => this.enabled.set(true)

  public disable = (): void => {
    this.enabled.set(false)
    this.navigation.setResetTimeout()
  }
}
