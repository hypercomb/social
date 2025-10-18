import { Injectable, computed, effect, inject, signal } from "@angular/core"
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

  private lastX = 0
  private lastY = 0
  private anchored = false
  private crossed = false

  // enable / disable
  private readonly enabled = signal(true)

  // reactive cancel signal → other services can watch for pan-abort
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

  public readonly canPan = computed(() =>
    this.enabled() &&
    this.focused() &&
    !this.suspendUntilUp() &&
    this.ps.dragOver() &&
    (this.keyboard.spaceDown() || this.isTouchPan()) &&
    !this.selections.canSelect() &&
    !this.manager.locked()
  )

  constructor() {
    super()

    // suspend on blur
    window.addEventListener("blur", () => {
      this.anchored = false
      this.suspendUntilUp.set(true)
    })

    window.addEventListener("focus", () => {
      // keep suspended until next pointer up
    })

    effect(() => {
      if (this.ps.upSeq() === 0) return
      if (!this.focused()) return
      if (!this.suspendUntilUp()) return
      this.suspendUntilUp.set(false)
    })

    // reset anchor when space toggles off
    effect(() => {
      if (!this.keyboard.spaceDown()) this.clearAnchor()
    })

    // pointer move → incremental pan
    effect(() => {
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.canPan()) return

      const isTouch = move.pointerType === "touch"
      if (isTouch && this.ps.activePointers().size === 0) return

      const container = this.pixi.container
      if (!container) return

      if (!this.anchored) {
        this.lastX = move.clientX
        this.lastY = move.clientY
        this.crossed = false
        this._cancelled.set(false)
        this.navigation.cancelled = false
        this.anchored = true
        return
      }

      const dx = move.clientX - this.lastX
      const dy = move.clientY - this.lastY
      if (dx === 0 && dy === 0) return

      // threshold → cancel click actions once
      if (!this.crossed) {
        const t = this.settings.panThreshold
        if (Math.abs(dx) > t || Math.abs(dy) > t) {
          this.crossed = true
          this._cancelled.set(true)
          this.navigation.cancelled = true
          this.events.panningThresholdAttained()
        }
      }

      container.position.set(container.position.x + dx, container.position.y + dy)
      this.lastX = move.clientX
      this.lastY = move.clientY

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

  private clearAnchor() {
    this.lastX = 0
    this.lastY = 0
    this.anchored = false
    this.crossed = false
    this._cancelled.set(false)
  }

  public enable = (): void => this.enabled.set(true)

  public disable = (): void => {
    this.enabled.set(false)
    this.navigation.setResetTimeout()
  }
}
